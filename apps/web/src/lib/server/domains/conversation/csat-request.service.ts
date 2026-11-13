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
 * close email adds rating links unless the conversation is rated or a rating
 * email already went out (`isCsatRatedOrEmailed`); a csat block in the thread
 * does not stop it, since a visitor who left the widget never saw the block.
 * The close email's own rating links are not a signal: the email log cannot tell a close email that carried them from one
 * that did not.
 *
 * A rating given in the thread (a matched reply to a csat block) is recorded
 * when it is sent (sendVisitorMessage), whether or not a workflow run is
 * waiting on the block. A run that resumes on it skips its
 * `record_csat` when the conversation is already rated.
 */
import { db, eq, sql, conversations } from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'

type Executor = Database | Transaction

type CsatSignals = { rated: boolean; asked: boolean; emailed: boolean }

async function readCsatSignals(
  conversationId: ConversationId,
  executor: Executor
): Promise<CsatSignals | null> {
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
  return row ?? null
}

/** Whether this conversation was already asked for a rating, or already rated. */
export async function isCsatAlreadyRequested(
  conversationId: ConversationId,
  executor: Executor = db
): Promise<boolean> {
  const signals = await readCsatSignals(conversationId, executor)
  return !!signals && (signals.rated || signals.asked || signals.emailed)
}

/**
 * Whether the conversation is rated or a rating email already went out. The
 * close email asks with this narrower rule: an unanswered csat block in the
 * thread does not count, because a visitor who left the widget never saw it
 * and still needs a way to rate.
 */
export async function isCsatRatedOrEmailed(conversationId: ConversationId): Promise<boolean> {
  const signals = await readCsatSignals(conversationId, db)
  return !!signals && (signals.rated || signals.emailed)
}

/** Whether the conversation already has a rating on file. */
export async function isConversationRated(conversationId: ConversationId): Promise<boolean> {
  const signals = await readCsatSignals(conversationId, db)
  return !!signals && signals.rated
}

/**
 * The precondition for posting a csat block, run on the posting transaction
 * after it locks the conversation row: true when no earlier signal exists.
 */
export function mayAskForCsat(conversationId: ConversationId) {
  return async (tx: Transaction): Promise<boolean> =>
    !(await isCsatAlreadyRequested(conversationId, tx))
}
