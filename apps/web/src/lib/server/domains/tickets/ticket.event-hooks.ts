/**
 * Ticket side effects driven off the shared event bus (convergence Phase 1a —
 * scratchpad/convergence-design.md, second-opinion dealbreaker 3). Same
 * lazy-import pattern as sla.event-hooks.ts: the event reactions
 * (events/event-reactions.ts) route every `message.created` here, the hook
 * swallows its own errors, and the pure-DB recorders never re-enter the bus.
 *
 * Two reactions live here, both off `message.created` on a conversation paired
 * with a CUSTOMER ticket:
 *
 * - A VISITOR message reopens that ticket (`autoReopenOnRequesterReply`).
 *   Without it a Messenger reply on the conversation would leave the ticket
 *   stuck in "Waiting on customer" — the exact incoherence convergence exists
 *   to kill (the portal/widget reply path already reopens directly; this hook
 *   covers the conversation-native channels and is idempotent against the
 *   direct call).
 * - Any customer-visible message becomes the ticket's `ticket.replied`
 *   (`emitPairTicketRepliedFromEvent`), so the ticket's watchers hear about a
 *   reply whichever surface it was written on.
 *
 * LOOP SAFETY: the reopen emits `ticket.status_changed` and the reply emits
 * `ticket.replied`, never `message.created` (system stage notices — re-parented to the conversation or
 * not — are author-less inserts that dispatch nothing), so this hook can never
 * re-trigger itself; the recorders it calls are status-guarded no-ops when the
 * ticket is already open.
 */
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import { db, and, eq, isNull, conversationMessages, principal, tickets } from '@/lib/server/db'
import { toMessageDTO } from '@/lib/server/messages/message-core'
import { isTeamMember } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'
import { autoReopenOnRequesterReply } from './ticket.service'
import { resolvePairTicketIdForConversation } from './pair-thread.service'
import { safeSubscribeToTicket } from './ticket-subscription.service'
import { emitTicketRepliedAs } from './ticket.webhooks'

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
 * Raise `ticket.replied` for a customer-visible message on the conversation
 * side of a ticket pair. Every such message lands on the conversation — the
 * ticket reply paths redirect there (ticket-message.service.ts), and the
 * inbox, Messenger, portal and conversation email write there natively — so
 * this reaction is the ONE place a pair's reply becomes a ticket reply,
 * whichever surface it came from. Before it, only the two ticket-path writes
 * fired `ticket.replied` themselves, and since the team-wide visitor bell is
 * suppressed for pairs (`getMessageCreatedTargets`), a reply sent from the
 * conversation row or a requester's Messenger reply reached no watcher at
 * all. The ticket-path writes therefore no longer emit directly on a pair;
 * standalone tickets still do.
 *
 * The same watch rules as the ticket paths: an agent reply subscribes the
 * teammate (reason 'replier'), a requester reply re-subscribes the requester
 * (B18's interaction re-opt-in). Both are insert-if-absent, so a repeat of
 * the event (a retried job) changes nothing, and a muted row stays muted.
 * A retried job does re-dispatch the reply; the reactions queue only retries
 * when another reaction on the same event failed, the same window the reopen
 * above already accepts.
 *
 * LOOP SAFETY: `ticket.replied` is not a reaction trigger and nothing it
 * fans out to writes a conversation message, so this never re-enters itself.
 */
export async function emitPairTicketRepliedFromEvent(event: EventData): Promise<void> {
  try {
    if (event.type !== 'message.created') return
    const sent = event.data.message
    const ticketId = await resolvePairTicketIdForConversation(sent.conversationId as ConversationId)
    if (!ticketId) return

    const [ticket] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
      .limit(1)
    if (!ticket || ticket.type !== 'customer') return

    // The stored row, not the event's flattened copy: the webhook payload
    // carries the rich body and attachments, and a message deleted before the
    // job ran is no longer a reply anyone should hear about.
    const [row] = await db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, sent.id as ConversationMessageId),
          isNull(conversationMessages.deletedAt)
        )
      )
      .limit(1)
    if (!row || row.isInternal) return
    if (row.senderType !== 'agent' && row.senderType !== 'visitor') return

    const authorId = (row.principalId as PrincipalId | null) ?? null
    const author = authorId
      ? ((await loadAuthors([authorId], { preferAccountName: true })).get(authorId) ??
        fallbackAuthor(authorId))
      : null

    if (authorId && row.senderType === 'agent') {
      const [who] = await db
        .select({ type: principal.type, role: principal.role })
        .from(principal)
        .where(eq(principal.id, authorId))
        .limit(1)
      // The assistant and integration service principals reply on the thread
      // but never watch it.
      if (who?.type === 'user' && isTeamMember(who.role)) {
        await safeSubscribeToTicket(authorId, ticketId, 'replier')
      }
    } else if (authorId && authorId === ticket.requesterPrincipalId) {
      await safeSubscribeToTicket(authorId, ticketId, 'requester')
    }

    await emitTicketRepliedAs(event.actor, ticket, toMessageDTO(row, author))
  } catch (err) {
    log.error({ err, eventType: event.type }, 'pair-ticket reply failed')
  }
}
