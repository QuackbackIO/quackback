/**
 * Requester-facing ticket operations (support platform §4.2, 7C). A requester is
 * NOT a team agent, so every entry point here gates on OWNERSHIP — the actor is
 * the requester of a `customer` ticket — never on the agent `ticket.*`
 * permissions. Internal notes are stripped from the requester's thread, and a
 * requester reply posts as a customer-visible visitor message.
 */
import { db, tickets, eq, and, isNull, desc, type Ticket } from '@/lib/server/db'
import type { TicketId, PrincipalId } from '@quackback/ids'
import type { Actor, PrincipalType } from '@/lib/server/policy/types'
import type { TiptapContent, ConversationAttachment } from '@/lib/shared/db-types'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'
import { loadTicketOr404, createTicketCore, autoReopenOnRequesterReply } from './ticket.service'
import { emitTicketReplied } from './ticket.webhooks'
import { buildTicketContext, ticketToDTO } from './ticket.dto'
import {
  insertTicketMessage,
  listTicketMessages,
  type SendTicketMessageInput,
  type TicketMessagePage,
} from './ticket-message.service'
import type { TicketDTO } from './ticket.types'

const LIST_LIMIT = 100

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

/** Every `customer` ticket the actor filed, newest activity first. */
export async function listMyTickets(actor: Actor): Promise<TicketDTO[]> {
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
  return rows.map((r) => ticketToDTO(r, ctx))
}

/** A single ticket the actor owns as requester. */
export async function getMyTicket(actor: Actor, ticketId: TicketId): Promise<TicketDTO> {
  const principalId = requireRequester(actor)
  const ticket = await loadOwnedTicketOr404(ticketId, principalId)
  const ctx = await buildTicketContext([ticket])
  return ticketToDTO(ticket, ctx)
}

/** The customer-visible thread of a ticket the actor owns (internal notes stripped). */
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
 */
export async function createMyTicket(
  actor: Actor,
  input: {
    title: string
    description?: string
    descriptionJson?: TiptapContent | null
    attachments?: ConversationAttachment[]
  }
): Promise<TicketDTO> {
  const principalId = requireRequester(actor)
  return createTicketCore(
    {
      type: 'customer',
      title: input.title,
      description: input.description,
      descriptionJson: input.descriptionJson,
      attachments: input.attachments,
      requesterPrincipalId: principalId,
    },
    actor
  )
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
 */
async function appendRequesterReply(
  ticketId: TicketId,
  requesterPrincipalId: PrincipalId,
  input: SendTicketMessageInput,
  actor: Actor
): Promise<{ message: ConversationMessageDTO }> {
  const { message, ticket } = await insertTicketMessage(input, requesterPrincipalId, {
    senderType: 'visitor',
    isInternal: false,
    stampFirstResponse: false,
  })
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

/** Stop watching the requester's own ticket. */
export async function unwatchMyTicket(actor: Actor, ticketId: TicketId): Promise<void> {
  const principalId = requireRequester(actor)
  await loadOwnedTicketOr404(ticketId, principalId)
  const { unsubscribeFromTicket } = await import('./ticket-subscription.service')
  await unsubscribeFromTicket(principalId, ticketId)
}
