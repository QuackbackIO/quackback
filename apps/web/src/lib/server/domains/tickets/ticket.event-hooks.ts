/**
 * Ticket side effects driven off the shared event bus (convergence Phase 1a —
 * scratchpad/convergence-design.md, second-opinion dealbreaker 3). Same
 * lazy-import pattern as sla.event-hooks.ts: the event reactions
 * (events/event-reactions.ts) route every `message.created` here, the hook
 * swallows its own errors, and the pure-DB recorders never re-enter the bus.
 *
 * Today exactly one reaction lives here: a VISITOR `message.created` on a
 * conversation paired with a CUSTOMER ticket reopens that ticket
 * (`autoReopenOnRequesterReply`). Without it a Messenger reply on the
 * conversation would leave the ticket stuck in "Waiting on customer". The
 * portal ticket reply path (requester.service) also reopens directly; this
 * hook covers every reply written on the conversation and is idempotent
 * against that direct call. A rating (a reply to a csat block) is not the
 * requester reopening the ticket, so it never reopens it.
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
    // A reply to a conversation block (a rating, a button, a collected field)
    // answers a prompt the conversation posted, not a new request: the ticket
    // stays as it is, as the conversation does (applyVisitorReopenStatus).
    if (event.data.message.blockReplyKind) return
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
