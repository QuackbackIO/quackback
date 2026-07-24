/**
 * Requester-facing ticket operations (support platform §4.2, 7C). A requester is
 * NOT a team agent, so every entry point here gates on OWNERSHIP — the actor is
 * the requester of a `customer` ticket — never on the agent `ticket.*`
 * permissions. Internal notes are stripped from the requester's thread, and a
 * requester reply posts as a customer-visible visitor message.
 */
import {
  db,
  tickets,
  ticketConversations,
  ticketStatuses,
  principal,
  eq,
  and,
  inArray,
  isNull,
  desc,
  type Ticket,
} from '@/lib/server/db'
import type { ConversationId, TicketId, TicketTypeId, PrincipalId } from '@quackback/ids'
import type { Actor, PrincipalType } from '@/lib/server/policy/types'
import type { TiptapContent, ConversationAttachment } from '@/lib/shared/db-types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'
import { loadTicketOr404, createTicketCore, autoReopenOnRequesterReply } from './ticket.service'
import { emitTicketReplied } from './ticket.webhooks'
import { buildTicketContext, ticketToDTO, toRequesterTicketDTO } from './ticket.dto'
import { markTicketReadForRequester, requesterTicketUnreadMap } from './ticket-unread.service'
import {
  insertTicketMessage,
  listTicketMessages,
  type SendTicketMessageInput,
  type TicketMessagePage,
} from './ticket-message.service'
import type { RequesterTicketDTO, TicketStageRef } from './ticket.types'
import { resolveStage } from './ticket.lifecycle'
import { getStageLabels } from '../settings/settings.tickets'
import { formatTicketNumber } from '@/lib/shared/tickets'

const LIST_LIMIT = 100

/** The signed-in requester's principal id, or refuse. */
function requireRequester(actor: Actor): PrincipalId {
  if (!actor.principalId) throw new ForbiddenError('FORBIDDEN', 'You must be signed in')
  return actor.principalId
}

/** Normalize a contact email; returns undefined when it isn't plausibly one. */
function normalizeContactEmail(raw: string | undefined | null): string | undefined {
  const email = raw?.trim().toLowerCase() ?? ''
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined
  return email
}

/** Whether a raw string is a plausible contact email — the single predicate the
 *  widget fn gate and the capture path both use, so the two can't drift. */
export function isPlausibleContactEmail(raw: string | undefined | null): boolean {
  return normalizeContactEmail(raw) !== undefined
}

/**
 * Whether the requester has a durable contact channel that survives their
 * session. A verified (`user`) principal carries an account email, so it always
 * qualifies. An `anonymous` principal (a widget visitor whose 7-day token can
 * expire) qualifies only once a `contactEmail` has been captured onto their
 * principal. Discriminates on the resolved `Actor.principalType`, never a raw
 * principal string (auth-helpers warns that collapsing anonymous is a security
 * bug). `service` principals never reach these requester paths.
 */
export async function requesterHasContactChannel(actor: Actor): Promise<boolean> {
  if (actor.principalType !== 'anonymous') return true
  if (!actor.principalId) return false
  const [row] = await db
    .select({ contactEmail: principal.contactEmail })
    .from(principal)
    .where(eq(principal.id, actor.principalId))
    .limit(1)
  return Boolean(row?.contactEmail)
}

/**
 * Refuse a requester write when there is no durable contact channel — otherwise
 * an anonymous visitor's ticket has no way to reach them once the 7-day token
 * expires. Refused with a discriminable `EMAIL_REQUIRED`.
 */
async function assertRequesterContactChannel(actor: Actor): Promise<void> {
  if (await requesterHasContactChannel(actor)) return
  throw new ForbiddenError(
    'EMAIL_REQUIRED',
    'An email address is required to file or reply to a ticket'
  )
}

/**
 * Overwrite-once capture of a requester's contact email onto their principal —
 * the same pattern pre-chat capture uses (`UPDATE ... WHERE contact_email IS
 * NULL`), so a later ticket can never silently replace an address already on
 * file. A non-plausible email is a no-op (`captured: false`). Returns whether a
 * new address was written.
 */
export async function captureRequesterEmail(
  principalId: PrincipalId,
  rawEmail: string
): Promise<{ captured: boolean }> {
  const email = normalizeContactEmail(rawEmail)
  if (!email) return { captured: false }
  const res = await db
    .update(principal)
    .set({ contactEmail: email })
    .where(and(eq(principal.id, principalId), isNull(principal.contactEmail)))
    .returning({ id: principal.id })
  return { captured: res.length > 0 }
}

/**
 * Load a ticket the actor owns as its requester, or 404. A requester only ever
 * sees their own `customer` tickets; anything else 404s so existence never leaks.
 */
async function loadOwnedTicketOr404(ticketId: TicketId, principalId: PrincipalId): Promise<Ticket> {
  const ticket = await loadTicketOr404(ticketId)
  if (ticket.type !== 'customer' || ticket.requesterPrincipalId !== principalId) {
    throw new NotFoundError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`)
  }
  return ticket
}

/** Every `customer` ticket the actor filed, newest activity first. Each row
 *  carries the requester's unread count — CONVERGENCE PHASE 6 (0218): every
 *  requester-holding customer ticket is a pair, so the count always reads the
 *  CONVERSATION's visitor watermark (the pair's shared truth; see
 *  requesterTicketUnreadMap). */
export async function listMyTickets(actor: Actor): Promise<RequesterTicketDTO[]> {
  const principalId = requireRequester(actor)
  const rows = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.requesterPrincipalId, principalId),
        eq(tickets.type, 'customer'),
        isNull(tickets.deletedAt)
      )
    )
    .orderBy(desc(tickets.updatedAt), desc(tickets.id))
    .limit(LIST_LIMIT)
  const ctx = await buildTicketContext(rows)
  const unreadMap = await requesterTicketUnreadMap(rows.map((r) => r.id))
  return rows.map((r) => ({
    ...ticketToDTO(r, ctx, 'requester'),
    unreadCount: unreadMap.get(r.id) ?? 0,
  }))
}

/**
 * The requester's customer ticket linked to `conversationId` (the converged
 * Messages surface's ticket header), or null when no pair exists or the ticket
 * isn't theirs. Scoped by BOTH the pair link and requester ownership, so a
 * mislinked row can never leak — post-1b the pair's requester IS the
 * conversation's visitor, so the ownership arm is defense in depth.
 */
export async function getRequesterTicketForConversation(
  conversationId: ConversationId,
  requesterPrincipalId: PrincipalId
): Promise<RequesterTicketDTO | null> {
  const [row] = await db
    .select({ ticket: tickets })
    .from(ticketConversations)
    .innerJoin(tickets, eq(ticketConversations.ticketId, tickets.id))
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer'),
        eq(tickets.requesterPrincipalId, requesterPrincipalId),
        isNull(tickets.deletedAt)
      )
    )
    .limit(1)
  if (!row) return null
  const ctx = await buildTicketContext([row.ticket])
  return ticketToDTO(row.ticket, ctx, 'requester')
}

/** A Messages-list row's linked-ticket decoration: stage chip + reference. */
export interface ConversationTicketSummary {
  ticketId: TicketId
  reference: string
  title: string
  stage: TicketStageRef
}

/**
 * Batch the linked-ticket summaries for a page of the requester's conversation
 * list — one query for the pairs, one for their statuses. The row's displayed
 * state keys off the TICKET's stage (the pair-state rule: a closed
 * conversation whose ticket is still open must not read "Closed"), which is
 * exactly what this summary carries.
 */
export async function getRequesterTicketSummaries(
  conversationIds: ConversationId[],
  requesterPrincipalId: PrincipalId
): Promise<Map<ConversationId, ConversationTicketSummary>> {
  const map = new Map<ConversationId, ConversationTicketSummary>()
  if (conversationIds.length === 0) return map
  const rows = await db
    .select({
      conversationId: ticketConversations.conversationId,
      ticketId: tickets.id,
      number: tickets.number,
      title: tickets.title,
      statusId: tickets.statusId,
    })
    .from(ticketConversations)
    .innerJoin(tickets, eq(ticketConversations.ticketId, tickets.id))
    .where(
      and(
        inArray(ticketConversations.conversationId, conversationIds),
        eq(ticketConversations.ticketType, 'customer'),
        eq(tickets.requesterPrincipalId, requesterPrincipalId),
        isNull(tickets.deletedAt)
      )
    )
  if (rows.length === 0) return map
  const statusIds = [...new Set(rows.map((r) => r.statusId))]
  const [statusRows, stageLabels] = await Promise.all([
    db.select().from(ticketStatuses).where(inArray(ticketStatuses.id, statusIds)),
    getStageLabels(),
  ])
  const statuses = new Map(statusRows.map((s) => [s.id, s]))
  for (const r of rows) {
    const status = statuses.get(r.statusId)
    const slot = status ? resolveStage(status) : null
    map.set(r.conversationId, {
      ticketId: r.ticketId,
      reference: formatTicketNumber(r.number),
      title: r.title,
      stage: {
        slot,
        label: slot ? stageLabels[slot] : null,
        closed: status?.category === 'closed',
      },
    })
  }
  return map
}

/** A single ticket the actor owns as requester. */
export async function getMyTicket(actor: Actor, ticketId: TicketId): Promise<RequesterTicketDTO> {
  const principalId = requireRequester(actor)
  const ticket = await loadOwnedTicketOr404(ticketId, principalId)
  const ctx = await buildTicketContext([ticket])
  const unreadMap = await requesterTicketUnreadMap([ticket.id])
  return { ...ticketToDTO(ticket, ctx, 'requester'), unreadCount: unreadMap.get(ticket.id) ?? 0 }
}

/**
 * The requester opens (reads) their own ticket thread — the portal/widget
 * ticket-page view's mark-read. Ownership-gated like the reads above.
 * CONVERGENCE PHASE 2 (read-through): `markTicketReadForRequester` resolves
 * the pair and, for a linked customer ticket, writes the CONVERSATION's
 * visitor watermark — the Messages space lists the pair natively off that
 * watermark, so reading the ticket page clears both spaces' badges. Post-0218
 * every requester-holding customer ticket is a pair, so the legacy
 * ticket-column write is unreachable from here (it stays for
 * back-office/tracker mark-reads).
 */
export async function markMyTicketRead(actor: Actor, ticketId: TicketId): Promise<void> {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(ticketId, principalId)
  await markTicketReadForRequester(ticketId, actor)
}

/**
 * The customer-visible thread of a ticket the actor owns (internal notes
 * stripped). CONVERGENCE PHASE 0: this is the SHARED pair thread — the portal
 * (`getMyTicketThreadFn`) and widget (`getMyWidgetTicketThreadFn`) views of a
 * linked ticket render the union of legacy ticket messages and the paired
 * conversation's messages, via listTicketMessages' delegation to the
 * pair-thread union loader (pair-thread.service.ts). A standalone ticket
 * degenerates to its own legacy thread.
 */
export async function getMyTicketThread(
  actor: Actor,
  ticketId: TicketId,
  opts: { before?: string } = {}
): Promise<TicketMessagePage> {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(ticketId, principalId)
  return listTicketMessages(ticketId, { before: opts.before, includeInternal: false })
}

/**
 * The requester opens their own ticket. Forced to the `customer` type and to the
 * caller as requester, so it can never file for someone else or raise an internal
 * type. The opt-in enablement (support tickets on) is gated at the fn layer.
 *
 * CONVERGENCE PHASE 1b: this is a customer-intake path, so the ticket is born
 * with its backing conversation + pair link in one transaction
 * (`withBackingConversation` — see createTicketCore's doc for the transaction
 * contract and the side-effect gating table). Both the portal fn and the
 * widget fn funnel here, so one flag covers both surfaces.
 */
export async function createMyTicket(
  actor: Actor,
  input: {
    title: string
    description?: string
    descriptionJson?: TiptapContent | null
    attachments?: ConversationAttachment[]
    /** The registry type filed under (convergence Phase 4) — already resolved
     *  + intake-eligibility-checked by the fn layer (live, customer category,
     *  intake-visible). Null/absent = the legacy typeless shape. */
    ticketTypeId?: TicketTypeId | null
    /** Validated intake-form answers, stored on the ticket's customAttributes. */
    customAttributes?: Record<string, unknown>
  }
): Promise<RequesterTicketDTO> {
  const principalId = requireRequester(actor)
  // Anonymous requesters must have a durable contact channel (email) on file —
  // the widget email-capture tier writes it before calling this (defense in
  // depth: the fn layer enforces the same guard).
  await assertRequesterContactChannel(actor)
  const created = await createTicketCore(
    {
      type: 'customer',
      ticketTypeId: input.ticketTypeId,
      title: input.title,
      description: input.description,
      descriptionJson: input.descriptionJson,
      attachments: input.attachments,
      customAttributes: input.customAttributes,
      requesterPrincipalId: principalId,
      withBackingConversation: true,
    },
    actor
  )
  return toRequesterTicketDTO(created)
}

/**
 * The requester-reply write core, shared by the portal reply (`replyToMyTicket`)
 * and the reply-by-email ingest (`appendInboundTicketReply`). The CALLER owns the
 * ownership check (portal: signed-in requester; email: verified From ↔ requester);
 * this only performs the append with requester semantics — `senderType: 'visitor'`,
 * `isInternal: false`, not a "first response" — then the §4.2 auto-reopen and the
 * agent/integration-facing `ticket.replied` signal (fire-and-forget). `actor` is
 * the requester, threaded through so the reopen timeline and the event actor read
 * as the requester, never as an anonymous system flip.
 *
 * RE-OPT-IN ON REPLY (B18): replying re-subscribes the requester (reason
 * 'requester') — the interaction-based watch rule that lets "Stop watching"
 * be honored honestly everywhere else. `subscribeToTicket` is
 * insert-if-absent, so this only recreates a row the requester deleted via
 * the portal toggle (an existing row, muted or not, is untouched — a mute
 * still wins). Both reply channels funnel through here, so portal and email
 * replies re-opt in identically. The requester is the ACTOR of the
 * reopen/`ticket.replied` signals below, so they never bell/email themselves
 * for their own reply regardless.
 */
async function appendRequesterReply(
  ticketId: TicketId,
  requesterPrincipalId: PrincipalId,
  input: SendTicketMessageInput,
  actor: Actor
): Promise<{ message: ConversationMessageDTO }> {
  // CONVERGENCE PHASE 1a: on a linked pair the insert redirects to the
  // conversation (the full conversation write pipeline runs there); the
  // reopen + `ticket.replied` below are ticket-side and fire either way.
  const { message, ticket } = await insertTicketMessage(input, requesterPrincipalId, {
    senderType: 'visitor',
    isInternal: false,
    stampFirstResponse: false,
    actor,
  })
  const { safeSubscribeToTicket } = await import('./ticket-subscription.service')
  await safeSubscribeToTicket(requesterPrincipalId, ticketId, 'requester')
  await autoReopenOnRequesterReply(ticketId, requesterPrincipalId)
  void emitTicketReplied(actor, ticket, message)
  return { message }
}

/** The requester replies on their own ticket thread (a customer-visible message). */
export async function replyToMyTicket(
  actor: Actor,
  input: SendTicketMessageInput
): Promise<{ message: ConversationMessageDTO }> {
  const principalId = requireRequester(actor)
  await assertRequesterContactChannel(actor)
  await loadOwnedTicketOr404(input.ticketId, principalId)
  return appendRequesterReply(input.ticketId, principalId, input, actor)
}

/**
 * Reply-by-email ingest core: append an inbound email as the requester's reply on
 * their ticket thread, with the exact `replyToMyTicket` semantics (visitor message,
 * auto-reopen, `ticket.replied`). The caller (the inbound email pipeline) has
 * already verified the signed `tkt-` address AND that the sender matches the
 * ticket's requester, so this takes the resolved `requesterPrincipalId` and its
 * type directly — there is no signed-in `Actor` on the inbound path, so one is
 * synthesized for the requester to drive the reopen-timeline attribution and the
 * event actor. A requester is never a `service` principal, so the synthesized
 * actor's role/segments/permissions are empty (unused by the requester-reply path).
 */
export async function appendInboundTicketReply(
  ticketId: TicketId,
  requesterPrincipalId: PrincipalId,
  input: {
    content: string
    contentJson?: TiptapContent | null
    attachments?: ConversationAttachment[]
    metadata?: Record<string, unknown>
  },
  requesterPrincipalType: PrincipalType = 'user'
): Promise<{ message: ConversationMessageDTO }> {
  const actor: Actor = {
    principalId: requesterPrincipalId,
    role: null,
    principalType: requesterPrincipalType,
    segmentIds: new Set(),
  }
  return appendRequesterReply(ticketId, requesterPrincipalId, { ticketId, ...input }, actor)
}

// ---------------------------------------------------------------------------
// Watch (ticket subscriptions), requester side: ownership-gated wrappers over
// the subscription service. Watch/unwatch only — no requester mute (the
// requester's volume is two events per ticket; per-type preferences live in
// portal settings).
// ---------------------------------------------------------------------------

/** Watch state for the requester's own ticket. */
export async function getMyTicketWatchStatus(actor: Actor, ticketId: TicketId) {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(ticketId, principalId)
  const { getTicketWatchStatus } = await import('./ticket-subscription.service')
  return getTicketWatchStatus(principalId, ticketId)
}

/** Re-watch the requester's own ticket (reason 'manual' — an explicit opt-in). */
export async function watchMyTicket(actor: Actor, ticketId: TicketId): Promise<void> {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(ticketId, principalId)
  const { subscribeToTicket } = await import('./ticket-subscription.service')
  await subscribeToTicket(principalId, ticketId, 'manual')
}

/**
 * Stop watching the requester's own ticket. Honored everywhere (B18): with
 * the row gone, the requester drops out of the status-change bell and the
 * resolved email (the two resolvers reach the requester THROUGH this row),
 * exactly as they already dropped out of reply emails. Replies re-subscribe
 * them (appendRequesterReply's re-opt-in rule), so the escape hatch is never
 * a one-way door.
 */
export async function unwatchMyTicket(actor: Actor, ticketId: TicketId): Promise<void> {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(ticketId, principalId)
  const { unsubscribeFromTicket } = await import('./ticket-subscription.service')
  await unsubscribeFromTicket(principalId, ticketId)
}
