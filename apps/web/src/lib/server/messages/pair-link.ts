/**
 * Pair-link SQL fragments (convergence): predicates over the
 * `ticket_conversations` 1:1 customer pair edge shared by domains that cannot
 * import the tickets domain (the one-directional edge rule keeps pair
 * semantics out of conversation.query.ts's reach).
 *
 * Kept in lib/server/messages — neutral territory both the conversation and
 * inbox domains already import — so the alias semantics exist exactly once.
 */
import { sql, conversations, tickets, ticketConversations } from '@/lib/server/db'

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
