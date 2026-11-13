/**
 * The one rule for asking a customer to rate a conversation: a conversation is
 * asked at most once. Every path that asks reads the same signals:
 *
 *   - a rating on file (`conversations.csat_rating`),
 *   - a csat block posted in the thread (an answered or pending in-thread ask),
 *   - a `CsatRequestEmail` in the email log (the rating email a csat block
 *     sends on channels with no in-thread ask).
 *
 * A workflow's csat block posts only when none is present, checked under the
 * conversation row lock in the same transaction as the post
 * (`mayAskForCsat`), so two workflows asking at once post one block. The
 * close email adds rating links only when none is present
 * (`isCsatAlreadyRequested`). The close email's own rating links are not a
 * signal: the email log cannot tell a close email that carried them from one
 * that did not.
 *
 * A rating given in the thread (a matched reply to a csat block) is recorded
 * when it is sent (sendVisitorMessage), whether or not a workflow run is
 * waiting on the block. A run that resumes on it records the same value
 * again, which recordCsat treats as no change.
 */
import { db, eq, sql, conversations } from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'

type Executor = Database | Transaction

/** Whether this conversation was already asked for a rating, or already rated. */
export async function isCsatAlreadyRequested(
  conversationId: ConversationId,
  executor: Executor = db
): Promise<boolean> {
  // One round trip. Column names are raw because a select-list expression
  // would drop the table prefix and self-correlate the subqueries.
  const [row] = await executor
    .select({
      rated: sql<boolean>`${conversations.csatRating} is not null`,
      asked: sql<boolean>`exists (
        select 1 from conversation_messages m
        where m.conversation_id = conversations.id
          and m.deleted_at is null
          and m.metadata -> 'block' ->> 'kind' = 'csat')`,
      emailed: sql<boolean>`exists (
        select 1 from email_log e
        where e.conversation_id = conversations.id
          and e.email_type = 'CsatRequestEmail')`,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return !!row && (row.rated || row.asked || row.emailed)
}

/**
 * The precondition for posting a csat block, run on the posting transaction
 * after it locks the conversation row: true when no earlier signal exists.
 */
export function mayAskForCsat(conversationId: ConversationId) {
  return async (tx: Transaction): Promise<boolean> =>
    !(await isCsatAlreadyRequested(conversationId, tx))
}
