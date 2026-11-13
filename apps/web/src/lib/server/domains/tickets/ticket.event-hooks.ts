/**
 * Ticket side effects driven off the shared event bus (convergence Phase 1a —
 * scratchpad/convergence-design.md, second-opinion dealbreaker 3). Same
 * lazy-import pattern as sla.event-hooks.ts: the event reactions
 * (events/event-reactions.ts) route every `message.created` here, the hook
 * swallows its own errors, and the pure-DB recorders never re-enter the bus.
 *
 * Two reactions live here. The first: a VISITOR `message.created` on a
 * conversation paired with a CUSTOMER ticket reopens that ticket
 * (`autoReopenOnRequesterReply`). Without it a Messenger reply on the
 * conversation would leave the ticket stuck in "Waiting on customer" — the
 * exact incoherence convergence exists to kill (the portal/widget reply path
 * already reopens directly; this hook covers the conversation-native channels
 * and is idempotent against the direct call).
 *
 * The second: any `message.created` or `message.deleted` on a conversation
 * paired with a customer ticket recomputes that ticket's first response from
 * the pair's message rows (ticket-first-response.ts). It reads the rows, not
 * the event, so it is idempotent and safe to run late, twice or out of order.
 * It swallows its own errors, so it never fails the shared reaction job: the
 * next message on the conversation, or the follow-up pass, corrects a value it
 * missed.
 *
 * LOOP SAFETY: the reopen emits `ticket.status_changed`, never
 * `message.created` (system stage notices — re-parented to the conversation or
 * not — are author-less inserts that dispatch nothing), so this hook can never
 * re-trigger itself; the recorders it calls are status-guarded no-ops when the
 * ticket is already open.
 */
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { autoReopenOnRequesterReply } from './ticket.service'
import { resolvePairTicketIdForConversation } from './pair-thread.service'
import { syncPairTicketFirstResponse } from './ticket-first-response'

const log = logger.child({ component: 'ticket-event-hooks' })

/**
 * Reopen the customer ticket paired with `message.created`'s conversation, if
 * any. The pair is 1:1 (the conversation side is unique by 0150's
 * `ticket_conversations_customer_uq`), so at most one ticket ever matches.
 * Agent/system messages and pair-less conversations return immediately.
 */
export async function autoReopenPairTicketFromEvent(event: EventData): Promise<void> {
  try {
    if (event.type !== 'message.created') return
    if (event.data.message.senderType !== 'visitor') return
    const conversationId = event.data.message.conversationId as ConversationId
    const ticketId = await resolvePairTicketIdForConversation(conversationId)
    if (!ticketId) return
    // The message author is the requester — threaded through so the reopen's
    // timeline record + event actor attribute the move to them (the function
    // no-ops unless the ticket is awaiting them or closed, so an already-open
    // ticket — e.g. the portal reply path's direct call having landed first —
    // records nothing twice). The message's own time lets a reaction that runs
    // late leave standing a close made after the message.
    const messageAt = new Date(event.data.message.createdAt)
    await autoReopenOnRequesterReply(
      ticketId,
      (event.data.message.authorPrincipalId as PrincipalId | null) ?? null,
      Number.isNaN(messageAt.getTime()) ? null : messageAt
    )
  } catch (err) {
    log.error({ err, eventType: event.type }, 'pair-ticket auto-reopen failed')
  }
}

/**
 * Recompute the first response of the customer ticket paired with the
 * message's conversation, if any. Does nothing for a conversation with no
 * paired ticket. Best-effort: an error is logged, never thrown.
 */
export async function recomputePairTicketFirstResponseFromEvent(event: EventData): Promise<void> {
  if (event.type !== 'message.created' && event.type !== 'message.deleted') return
  const conversationId = event.data.message.conversationId as ConversationId
  try {
    await syncPairTicketFirstResponse(conversationId)
  } catch (err) {
    log.warn(
      { err, eventType: event.type, conversation_id: conversationId },
      'ticket first response reaction failed'
    )
  }
}
