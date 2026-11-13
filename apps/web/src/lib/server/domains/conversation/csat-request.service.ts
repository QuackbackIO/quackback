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
 * when it is sent (`recordBlockRating`), whether or not a workflow run is
 * waiting on the block. A run that resumes on it records the same value
 * again, which recordCsat treats as no change.
 */
import { db, eq, and, isNull, sql, conversations, conversationMessages, emailLog } from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'csat-request' })

type Executor = Database | Transaction

/** Whether this conversation was already asked for a rating, or already rated. */
export async function isCsatAlreadyRequested(
  conversationId: ConversationId,
  executor: Executor = db
): Promise<boolean> {
  const [conversation] = await executor
    .select({ csatRating: conversations.csatRating })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (conversation?.csatRating != null) return true

  const [block] = await executor
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.metadata} -> 'block' ->> 'kind' = 'csat'`
      )
    )
    .limit(1)
  if (block) return true

  const [email] = await executor
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(eq(emailLog.conversationId, conversationId), eq(emailLog.emailType, 'CsatRequestEmail'))
    )
    .limit(1)
  return email !== undefined
}

/**
 * The precondition for posting a csat block, run on the posting transaction
 * after it locks the conversation row: true when no earlier signal exists.
 */
export function mayAskForCsat(conversationId: ConversationId) {
  return async (tx: Transaction): Promise<boolean> =>
    !(await isCsatAlreadyRequested(conversationId, tx))
}

/**
 * Record the rating a visitor gave by answering a csat block, as that
 * visitor. Runs after the message is committed and is best-effort: a refused
 * or failed rating never fails the message it came with.
 */
export async function recordBlockRating(
  conversationId: ConversationId,
  reply: { rating: number; comment?: string },
  actor: Actor
): Promise<void> {
  try {
    const { recordCsat } = await import('./conversation.service')
    await recordCsat(conversationId, reply.rating, reply.comment, actor)
  } catch (err) {
    log.warn({ err, conversationId }, 'csat block rating not recorded')
  }
}
