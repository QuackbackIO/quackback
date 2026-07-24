/**
 * Requester-facing ticket operations. A requester is NOT a team agent, so
 * every entry point here gates on OWNERSHIP — the actor is the requester of a
 * `customer` ticket — never on the agent `ticket.*` permissions.
 *
 * Converged Messages surface: a requester experiences their ticket AS its
 * conversation pair (one thread, ticket header on top), so this module carries
 * only the reads that decorate that surface (linked-ticket header + list
 * summaries), the watch bell, and the reply-by-email ingest core. Customer
 * ticket CREATION is agent-only; requester replies ride the conversation send
 * path.
 */
import {
  db,
  tickets,
  ticketConversations,
  ticketStatuses,
  eq,
  and,
  inArray,
  isNull,
  type Ticket,
} from '@/lib/server/db'
import type { ConversationId, TicketId, PrincipalId } from '@quackback/ids'
import type { Actor, PrincipalType } from '@/lib/server/policy/types'
import type { TiptapContent, ConversationAttachment } from '@/lib/shared/db-types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'
import { loadTicketOr404, autoReopenOnRequesterReply } from './ticket.service'
import { emitTicketReplied } from './ticket.webhooks'
import { buildTicketContext, ticketToDTO } from './ticket.dto'
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
