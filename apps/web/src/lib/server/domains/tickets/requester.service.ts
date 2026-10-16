/**
 * Requester-facing ticket operations. A requester is NOT a team agent, so
 * every entry point here gates on OWNERSHIP — the actor is the requester of a
 * `customer` ticket — never on the agent `ticket.*` permissions.
 *
 * Converged Messages surface: a requester experiences their ticket AS its
 * conversation pair (one thread, ticket header on top), so this module carries
 * the requester's own-ticket create (`createMyTicket`, used by the workflow
 * send_ticket_form block), the reads that decorate that surface (linked-ticket header +
 * list summaries), the watch bell, and the reply-by-email ingest core.
 * Requester replies ride the conversation send path.
 */
import {
  db,
  tickets,
  ticketConversations,
  ticketStatuses,
  conversationParticipants,
  principal,
  eq,
  and,
  desc,
  inArray,
  isNull,
  type Ticket,
} from '@/lib/server/db'
import type { ConversationId, TicketId, TicketTypeId, PrincipalId } from '@quackback/ids'
import type { Actor, PrincipalType } from '@/lib/server/policy/types'
import type { TiptapContent, ConversationAttachment } from '@/lib/shared/db-types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'
import { loadTicketOr404, createTicketCore, autoReopenOnRequesterReply } from './ticket.service'
import {
  emitTicketReplied,
  emitTicketSubscriberAdded,
  emitTicketSubscriberRemoved,
} from './ticket.webhooks'
import { buildTicketContext, ticketToDTO, toRequesterTicketDTO } from './ticket.dto'
import { hasParticipantThreadAccess } from '../conversation/conversation-participant.service'
import { insertTicketMessage, type SendTicketMessageInput } from './ticket-message.service'
import type { RequesterTicketDTO, TicketStageRef } from './ticket.types'
import { resolveStage } from './ticket.lifecycle'
import { getStageLabels } from '../settings/settings.tickets'
import { formatTicketNumber } from '@/lib/shared/tickets'

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
  throw new ForbiddenError('EMAIL_REQUIRED', 'An email address is required to file a ticket')
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

/** How a customer relates to a ticket they can see (ticket sharing). */
export type TicketRelation = 'requester' | 'participant'

/**
 * A customer ticket the caller can see: their own, or one shared with them (a
 * participant with the thread on its pair conversation). A requester only ever
 * sees `customer` tickets; anything else is NotFound so existence never leaks.
 */
export async function loadAccessibleTicketOr404(
  ticketId: TicketId,
  principalId: PrincipalId
): Promise<{ ticket: Ticket; relation: TicketRelation; conversationId: ConversationId | null }> {
  const ticket = await loadTicketOr404(ticketId)
  const notFound = () => new NotFoundError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`)
  if (ticket.type !== 'customer') throw notFound()
  const [pair] = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  const conversationId = pair?.conversationId ?? null
  if (ticket.requesterPrincipalId === principalId) {
    return { ticket, relation: 'requester', conversationId }
  }
  if (conversationId && (await hasParticipantThreadAccess(conversationId, principalId))) {
    return { ticket, relation: 'participant', conversationId }
  }
  throw notFound()
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
  /** The ticket's shared due date (ISO), null when none. */
  dueAt: string | null
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
  if (conversationIds.length === 0) return new Map()
  const rows = await db
    .select({
      conversationId: ticketConversations.conversationId,
      ticketId: tickets.id,
      number: tickets.number,
      title: tickets.title,
      statusId: tickets.statusId,
      dueAt: tickets.dueAt,
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
  return summarizePairs(rows)
}

/** Stage chip + reference for each pair row (one status read for the batch). */
export async function summarizePairs(
  rows: Array<{
    conversationId: ConversationId
    ticketId: TicketId
    number: number
    title: string
    statusId: Ticket['statusId']
    dueAt: Date | null
  }>
): Promise<Map<ConversationId, ConversationTicketSummary>> {
  const map = new Map<ConversationId, ConversationTicketSummary>()
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
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    })
  }
  return map
}

/**
 * A row in the requester's own-tickets list (the widget Tickets tab): the
 * reference, title, current public stage, and last activity stamp. Same
 * projection rule as ConversationTicketSummary — the displayed state keys off
 * the TICKET's stage, never an internal status detail.
 */
export interface MyTicketSummary {
  ticketId: TicketId
  reference: string
  title: string
  stage: TicketStageRef
  /** The pair's conversation — the row's click-through to its thread. Null on
   *  a legacy standalone ticket (pre-pair rows were never backfilled). */
  conversationId: ConversationId | null
  updatedAt: string
  /** The ticket's shared due date (ISO), null when none. */
  dueAt: string | null
  /** The caller's own ticket, or one a colleague or the team shared with them. */
  relation: TicketRelation
}

/**
 * The requester's own customer tickets, plus the ones shared with them,
 * newest-activity first. Ownership or a share IS the scope (no ticket.*
 * permission anywhere on this path), so a customer only ever sees tickets
 * that are theirs or were given to them;
 * internal-only statuses project to a null stage instead of leaking. Each row
 * carries its pair's conversation id so the widget row opens the shared
 * thread straight from the list.
 */
export async function listMyTicketSummaries(
  requesterPrincipalId: PrincipalId
): Promise<MyTicketSummary[]> {
  const columns = {
    ticketId: tickets.id,
    number: tickets.number,
    title: tickets.title,
    statusId: tickets.statusId,
    conversationId: ticketConversations.conversationId,
    updatedAt: tickets.updatedAt,
    dueAt: tickets.dueAt,
  }
  const [ownRows, sharedRows] = await Promise.all([
    db
      .select(columns)
      .from(tickets)
      .leftJoin(
        ticketConversations,
        and(
          eq(ticketConversations.ticketId, tickets.id),
          eq(ticketConversations.ticketType, 'customer')
        )
      )
      .where(
        and(
          eq(tickets.type, 'customer'),
          eq(tickets.requesterPrincipalId, requesterPrincipalId),
          isNull(tickets.deletedAt)
        )
      )
      .orderBy(desc(tickets.updatedAt))
      .limit(50),
    // Tickets shared with the caller: the thread on the pair's conversation.
    db
      .select(columns)
      .from(tickets)
      .innerJoin(
        ticketConversations,
        and(
          eq(ticketConversations.ticketId, tickets.id),
          eq(ticketConversations.ticketType, 'customer')
        )
      )
      .innerJoin(
        conversationParticipants,
        and(
          eq(conversationParticipants.conversationId, ticketConversations.conversationId),
          eq(conversationParticipants.principalId, requesterPrincipalId),
          eq(conversationParticipants.threadAccess, true)
        )
      )
      .where(and(eq(tickets.type, 'customer'), isNull(tickets.deletedAt)))
      .orderBy(desc(tickets.updatedAt))
      .limit(50),
  ])
  const rows = [
    ...ownRows.map((r) => ({ ...r, relation: 'requester' as const })),
    ...sharedRows
      .filter((r) => !ownRows.some((own) => own.ticketId === r.ticketId))
      .map((r) => ({ ...r, relation: 'participant' as const })),
  ]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 50)
  if (rows.length === 0) return []
  const statusIds = [...new Set(rows.map((r) => r.statusId))]
  const [statusRows, stageLabels] = await Promise.all([
    db.select().from(ticketStatuses).where(inArray(ticketStatuses.id, statusIds)),
    getStageLabels(),
  ])
  const statuses = new Map(statusRows.map((s) => [s.id, s]))
  return rows.map((r) => {
    const status = statuses.get(r.statusId)
    const slot = status ? resolveStage(status) : null
    return {
      ticketId: r.ticketId,
      reference: formatTicketNumber(r.number),
      title: r.title,
      stage: {
        slot,
        label: slot ? stageLabels[slot] : null,
        closed: status?.category === 'closed',
      },
      conversationId: r.conversationId,
      updatedAt: r.updatedAt.toISOString(),
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      relation: r.relation,
    }
  })
}

/**
 * The requester opens their own ticket. Forced to the `customer` type and to
 * the caller as requester, so it can never file for someone else or raise an
 * internal type. The opt-in enablement (support tickets on) is gated at the fn
 * layer.
 *
 * This is a customer-intake path, so the ticket is born with its backing
 * conversation + pair link in one transaction (`withBackingConversation` — see
 * createTicketCore's doc for the transaction contract and the side-effect
 * gating table), which is what lets the requester's Tickets-tab row click
 * straight through to its conversation thread.
 */
export async function createMyTicket(
  actor: Actor,
  input: {
    title: string
    description?: string
    descriptionJson?: TiptapContent | null
    attachments?: ConversationAttachment[]
    /** The registry type filed under — already resolved + intake-eligibility-
     *  checked by the fn layer (live, customer category, intake-visible).
     *  Null/absent = the legacy typeless shape. */
    ticketTypeId?: TicketTypeId | null
    /** Validated intake-form answers, stored on the ticket's customAttributes. */
    customAttributes?: Record<string, unknown>
    /** The requester's proposed "Needed by" date; createTicketCore holds it to
     *  the customer window (the requester files for themselves). */
    dueAt?: Date | null
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
      dueAt: input.dueAt ?? null,
      requesterPrincipalId: principalId,
      withBackingConversation: true,
    },
    actor
  )
  return toRequesterTicketDTO(created)
}

/**
 * The requester-reply write core behind the reply-by-email ingest
 * (`appendInboundTicketReply`). The CALLER owns the ownership check (email:
 * verified From ↔ requester); this only performs the append with requester
 * semantics — `senderType: 'visitor'`, `isInternal: false`, not a "first
 * response" — then the auto-reopen and the agent/integration-facing
 * `ticket.replied` signal (fire-and-forget). `actor` is the requester,
 * threaded through so the reopen timeline and the event actor read as the
 * requester, never as an anonymous system flip. (In-app requester replies
 * don't come through here at all — they ride the conversation send path on
 * the converged Messages surface.)
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
  // conversation (the full conversation write pipeline runs there). The reopen
  // below is ticket-side and runs either way; `ticket.replied` is emitted here
  // only for a ticket-parented reply, since the pair-reply reaction raises it
  // off the conversation's `message.created` (ticket.event-hooks.ts).
  const { message, ticket } = await insertTicketMessage(input, requesterPrincipalId, {
    senderType: 'visitor',
    isInternal: false,
    stampFirstResponse: false,
    actor,
  })
  const { safeSubscribeToTicket } = await import('./ticket-subscription.service')
  await safeSubscribeToTicket(requesterPrincipalId, ticketId, 'requester')
  await autoReopenOnRequesterReply(ticketId, requesterPrincipalId)
  if (!message.conversationId) void emitTicketReplied(actor, ticket, message)
  return { message }
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

/** Watch state for the caller's own ticket, or one shared with them. */
export async function getMyTicketWatchStatus(actor: Actor, ticketId: TicketId) {
  const principalId = requireRequester(actor)
  await loadAccessibleTicketOr404(ticketId, principalId)
  const { getTicketWatchStatus } = await import('./ticket-subscription.service')
  return getTicketWatchStatus(principalId, ticketId)
}

/** Re-watch the caller's own ticket (reason 'manual' — an explicit opt-in), or
 *  one shared with them (reason 'participant'). */
export async function watchMyTicket(actor: Actor, ticketId: TicketId): Promise<void> {
  const principalId = requireRequester(actor)
  const { ticket, relation } = await loadAccessibleTicketOr404(ticketId, principalId)
  // Someone the ticket was shared with watches as a participant, whose
  // notifications carry the customer view (portal links, no internal names).
  const reason = relation === 'participant' ? 'participant' : 'manual'
  const { subscribeToTicket } = await import('./ticket-subscription.service')
  if (await subscribeToTicket(principalId, ticketId, reason)) {
    void emitTicketSubscriberAdded(actor, ticket, principalId, reason)
  }
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
  const { ticket } = await loadAccessibleTicketOr404(ticketId, principalId)
  const { unsubscribeFromTicket } = await import('./ticket-subscription.service')
  const reason = await unsubscribeFromTicket(principalId, ticketId)
  if (reason) void emitTicketSubscriberRemoved(actor, ticket, principalId, reason)
}
