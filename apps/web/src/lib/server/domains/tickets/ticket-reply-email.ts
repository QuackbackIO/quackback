/**
 * The one email a customer gets when a teammate replies on their ticket.
 *
 * A customer ticket is paired with a conversation, and a teammate's reply lands
 * on that conversation whichever view it was typed in. The conversation email
 * (conversation.notify.ts, notifyAgentReply) carries it to the customer, so the
 * ticket reply email (events/targets.ts, getTicketRepliedEmailTargets) leaves
 * the customer out whenever that conversation is theirs. A ticket with no
 * conversation of the requester's still sends the ticket reply email.
 *
 * Either way the email honours the same two settings: the customer's "Ticket
 * replies" email switch and "Stop watching" on the ticket. "Pause all email"
 * does not stop it (see wantsTicketReplyEmail).
 */
import { db, and, eq, conversations, ticketConversations, tickets } from '@/lib/server/db'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import { batchGetNotificationPreferences } from '@/lib/server/domains/subscriptions/subscription.service'
import { wantsTicketReplyEmail } from '@/lib/server/domains/subscriptions/notification-matrix'
import { getTicketNotifiableWatchers } from './ticket-subscription.service'

/**
 * Whether the requester wants an email carrying a teammate's reply on this
 * ticket: they still watch it (no "Stop watching", no active mute) and their
 * "Ticket replies" email switch is on.
 */
export async function requesterWantsReplyEmail(
  ticketId: TicketId,
  requesterPrincipalId: PrincipalId
): Promise<boolean> {
  const watchers = await getTicketNotifiableWatchers(ticketId, requesterPrincipalId)
  if (!watchers.includes(requesterPrincipalId)) return false
  const prefs = await batchGetNotificationPreferences([requesterPrincipalId])
  return wantsTicketReplyEmail(prefs.get(requesterPrincipalId))
}

/**
 * The customer ticket this conversation is paired with, when this visitor is
 * its requester. Null for a conversation with no customer ticket, and for a
 * ticket someone else requested.
 */
export async function requesterTicketForConversation(
  conversationId: ConversationId,
  visitorPrincipalId: PrincipalId
): Promise<TicketId | null> {
  const [row] = await db
    .select({ ticketId: ticketConversations.ticketId })
    .from(ticketConversations)
    .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer'),
        eq(tickets.requesterPrincipalId, visitorPrincipalId)
      )
    )
    .limit(1)
  return (row?.ticketId as TicketId | undefined) ?? null
}

/**
 * Whether a teammate's reply on this ticket reaches the requester through the
 * conversation email: the ticket is paired with a conversation whose visitor
 * is the requester.
 */
export async function conversationEmailCarriesReplies(
  ticketId: TicketId,
  requesterPrincipalId: PrincipalId
): Promise<boolean> {
  const [row] = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .innerJoin(conversations, eq(conversations.id, ticketConversations.conversationId))
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, 'customer'),
        eq(conversations.visitorPrincipalId, requesterPrincipalId)
      )
    )
    .limit(1)
  return row != null
}
