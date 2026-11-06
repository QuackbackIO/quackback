/**
 * Pair-link SQL fragments (convergence): predicates over the
 * `ticket_conversations` 1:1 customer pair edge shared by domains that cannot
 * import the tickets domain (the one-directional edge rule keeps pair
 * semantics out of conversation.query.ts's reach).
 *
 * Kept in lib/server/messages — neutral territory both the conversation and
 * inbox domains already import — so the alias semantics exist exactly once.
 */
import {
  db,
  and,
  eq,
  isNull,
  sql,
  conversations,
  conversationParticipants,
  tickets,
  ticketConversations,
  ticketSubscriptions,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { ticketDueConditionSql } from '@/lib/server/db/ticket-due'
import type { TicketDueFilter } from '@/lib/shared/ticket-due'

/**
 * "This conversation carries an active customer-ticket link" (the convergence
 * alias semantics behind the Tickets-section scopes). EXISTS keeps the outer
 * select shape (conversations only); the tickets join excludes a link
 * pointing at a soft-deleted ticket so a deleted ticket's pair can't keep
 * listing. Used by `listConversationsForAgent`'s `hasLinkedCustomerTicket`
 * filter and the inbox nav's pair badge — one fragment keeps view and badge
 * in lockstep.
 */
export function hasLinkedCustomerTicketSql() {
  return sql`EXISTS (
    SELECT 1 FROM ${ticketConversations} tc
    INNER JOIN ${tickets} t ON t.id = tc.ticket_id AND t.deleted_at IS NULL
    WHERE tc.conversation_id = ${conversations.id}
      AND tc.ticket_type = 'customer'
  )`
}

/**
 * "This conversation's linked customer ticket matches the due-date filter":
 * the conversation side of the inbox's Due date filter. Most customer tickets
 * list as their linked conversation's row (the one-row rule), so the filter
 * has to reach through the pair edge to the ticket's `due_at`. The tickets
 * join stays unaliased so `ticketDueConditionSql`'s column references resolve
 * against it, and a soft-deleted ticket never matches.
 */
export function linkedCustomerTicketDueSql(filter: TicketDueFilter, now: Date) {
  return sql`EXISTS (
    SELECT 1 FROM ${ticketConversations} tc
    INNER JOIN ${tickets} ON ${tickets.id} = tc.ticket_id AND ${tickets.deletedAt} IS NULL
    WHERE tc.conversation_id = ${conversations.id}
      AND tc.ticket_type = 'customer'
      AND ${ticketDueConditionSql(filter, now)}
  )`
}

/**
 * The linked live customer ticket's `due_at` (NULL when there is no link, the
 * ticket was deleted, or it has no due date): the conversation list's 'due'
 * sort key. A correlated scalar subquery, like the 'sla' sort's expression;
 * the partial unique index on the customer edge guarantees at most one row.
 * Only for WHERE / ORDER BY: in a single-table select list drizzle renders
 * columns unqualified, which would re-bind `conversations.id` inside the
 * subquery. Read one conversation's value with
 * `loadLinkedCustomerTicketDueAt` instead.
 */
export function linkedCustomerTicketDueAtSql() {
  return sql<Date | null>`(
    SELECT ${tickets.dueAt} FROM ${ticketConversations} tc
    INNER JOIN ${tickets} ON ${tickets.id} = tc.ticket_id AND ${tickets.deletedAt} IS NULL
    WHERE tc.conversation_id = ${conversations.id}
      AND tc.ticket_type = 'customer'
    LIMIT 1
  )`
}

/**
 * One conversation's `linkedCustomerTicketDueAtSql` value, read directly: the
 * 'due' sort's keyset cursor re-read (only on a paged 'due' request).
 */
export async function loadLinkedCustomerTicketDueAt(
  conversationId: ConversationId
): Promise<Date | null> {
  const [row] = await db
    .select({ dueAt: tickets.dueAt })
    .from(ticketConversations)
    .innerJoin(
      tickets,
      and(eq(tickets.id, ticketConversations.ticketId), isNull(tickets.deletedAt))
    )
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  return row?.dueAt ?? null
}

/**
 * "This conversation is a pair whose customer ticket `principalId` watches"
 * (a ticket_subscriptions row, muted or not): the conversation branch of the
 * inbox's Watching view, where a watched pair lists as its conversation row
 * just as it does under the other Tickets-section scopes.
 */
export function pairTicketWatchedBySql(principalId: PrincipalId) {
  return sql`EXISTS (
    SELECT 1 FROM ${ticketConversations} tc
    INNER JOIN ${tickets} t ON t.id = tc.ticket_id AND t.deleted_at IS NULL
    INNER JOIN ${ticketSubscriptions} ON ${ticketSubscriptions.ticketId} = tc.ticket_id
    WHERE tc.conversation_id = ${conversations.id}
      AND tc.ticket_type = 'customer'
      AND ${eq(ticketSubscriptions.principalId, principalId)}
  )`
}

/**
 * "`principalId` was given this customer ticket's thread" (ticket sharing): a
 * participant row with `thread_access` on a conversation that is still a live
 * customer pair. Both halves are required, so a plain group-thread participant
 * (thread_access false) never qualifies, and deleting the ticket or its link
 * takes the shared thread away from everyone it was shared with. The one place
 * the rule is written: the access check, the customer's Messages list and its
 * unread badge all read it.
 */
export function participantThreadAccessSql(principalId: PrincipalId) {
  return and(
    sql`EXISTS (
      SELECT 1 FROM ${conversationParticipants}
      WHERE ${conversationParticipants.conversationId} = ${conversations.id}
        AND ${eq(conversationParticipants.principalId, principalId)}
        AND ${conversationParticipants.threadAccess}
    )`,
    hasLinkedCustomerTicketSql()
  )!
}

/**
 * For a `conversation_participants` row: the participant watches the customer
 * ticket paired with that conversation (a ticket_subscriptions row whose mute,
 * if any, has passed). A participant with the shared thread follows the ticket
 * like its requester does, so "Stop watching" quiets their reply emails too.
 */
export function participantWatchesPairTicketSql() {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${ticketConversations} tc
    INNER JOIN ${ticketSubscriptions} ON ${ticketSubscriptions.ticketId} = tc.ticket_id
    WHERE tc.conversation_id = ${conversationParticipants.conversationId}
      AND tc.ticket_type = 'customer'
      AND ${ticketSubscriptions.principalId} = ${conversationParticipants.principalId}
      AND (${ticketSubscriptions.mutedUntil} IS NULL OR ${ticketSubscriptions.mutedUntil} < now())
  )`
}
