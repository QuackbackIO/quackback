/**
 * Test conversations, test ideas and test tickets (the "Try Messenger" round
 * trip) are kept for a week and then deleted. A row is test only when a test
 * customer authored it, so every delete here joins through that identity and a
 * teammate's own ingress, or a legacy `test` attribute a client once wrote,
 * is never touched. Hard delete, like the spam sweep: child rows go through
 * the FK cascades.
 */
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { db, conversations, tickets, ticketConversations, and, inArray } from '@/lib/server/db'
import { isTestPrincipalSql } from '@/lib/server/test-data'
import { conversationFilter } from '@/lib/server/policy/conversations'
import type { Actor } from '@/lib/server/policy/types'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'test-data-retention' })

export const TEST_DATA_RETENTION_DAYS = 7

/** A test thread is one whose visitor is a test customer. */
export function isTestThreadSql(visitorPrincipalId: SQLWrapper): SQL {
  return isTestPrincipalSql(visitorPrincipalId)
}

/** Every test conversation the actor can see, with the test tickets paired to them. */
export async function deleteTestConversations(actor: Actor): Promise<number> {
  return db.transaction(async (tx) => {
    const doomed = tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(conversationFilter(actor), isTestThreadSql(conversations.visitorPrincipalId)))
    // A pair ticket's requester is the same test customer; delete it with its thread.
    await tx
      .delete(tickets)
      .where(
        and(
          isTestPrincipalSql(tickets.requesterPrincipalId),
          inArray(
            tickets.id,
            tx
              .select({ id: ticketConversations.ticketId })
              .from(ticketConversations)
              .where(inArray(ticketConversations.conversationId, doomed))
          )
        )
      )
    const rows = await tx
      .delete(conversations)
      .where(and(conversationFilter(actor), isTestThreadSql(conversations.visitorPrincipalId)))
      .returning({ id: conversations.id })
    log.info({ deleted: rows.length }, 'test conversations deleted')
    return rows.length
  })
}

async function sweepBatches(statement: () => SQL, batchSize: number): Promise<number> {
  let deleted = 0
  for (;;) {
    const batch = getExecuteRows<{ id: string }>(await db.execute(statement())).length
    deleted += batch
    if (batch < batchSize) return deleted
  }
}

/** One table's test rows older than the cutoff, found through their author's identity. */
function sweepStatement(
  table: 'conversations' | 'posts' | 'tickets',
  author: 'visitor_principal_id' | 'principal_id' | 'requester_principal_id',
  cutoffIso: string,
  batchSize: number
): () => SQL {
  return () => sql`
    DELETE FROM ${sql.identifier(table)} WHERE id IN (
      SELECT doomed.id FROM ${sql.identifier(table)} doomed
      INNER JOIN principal test_author ON test_author.id = doomed.${sql.identifier(author)}
      WHERE test_author.test_owner_principal_id IS NOT NULL
        AND doomed.created_at < ${cutoffIso}::timestamptz
      LIMIT ${batchSize}
    )
    RETURNING id`
}

export async function sweepTestData(opts?: {
  olderThanDays?: number
  batchSize?: number
}): Promise<{ conversations: number; posts: number; tickets: number }> {
  const olderThanDays = opts?.olderThanDays ?? TEST_DATA_RETENTION_DAYS
  const batchSize = opts?.batchSize ?? 500
  const cutoffIso = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()

  const ticketCount = await sweepBatches(
    sweepStatement('tickets', 'requester_principal_id', cutoffIso, batchSize),
    batchSize
  )
  const conversationCount = await sweepBatches(
    sweepStatement('conversations', 'visitor_principal_id', cutoffIso, batchSize),
    batchSize
  )
  const postCount = await sweepBatches(
    sweepStatement('posts', 'principal_id', cutoffIso, batchSize),
    batchSize
  )

  if (conversationCount + postCount + ticketCount > 0) {
    log.info(
      { conversations: conversationCount, posts: postCount, tickets: ticketCount, olderThanDays },
      'test data retention sweep deleted test rows'
    )
  }
  return { conversations: conversationCount, posts: postCount, tickets: ticketCount }
}
