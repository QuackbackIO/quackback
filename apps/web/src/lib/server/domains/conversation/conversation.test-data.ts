/**
 * Test conversations and test ideas (the "Try Messenger" round trip, or a
 * teammate writing in as a customer) are kept for a week and then deleted.
 * Hard delete, like the spam sweep: child rows go through the FK cascades.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { PrincipalId } from '@quackback/ids'
import { db, conversations } from '@/lib/server/db'
import { conversationFilter } from '@/lib/server/policy/conversations'
import type { Actor } from '@/lib/server/policy/types'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'test-data-retention' })

export const TEST_DATA_RETENTION_DAYS = 7

/** The marker the visitor-ingress seam stamps; sample data is not test data. */
export function isTestThreadSql(attributes: SQL | typeof conversations.customAttributes): SQL {
  return sql`coalesce(${attributes}->>'test', 'false') = 'true'`
}

function ownedBy(attributes: SQL, owner: PrincipalId | undefined): SQL {
  return owner ? sql`${attributes}->>'testOwnerPrincipalId' = ${owner}` : sql`true`
}

/** Every test conversation the actor can see, or only one owner's. */
export async function deleteTestConversations(
  actor: Actor,
  opts?: { ownerPrincipalId?: PrincipalId }
): Promise<number> {
  const rows = await db
    .delete(conversations)
    .where(
      sql`${conversationFilter(actor)} and ${isTestThreadSql(conversations.customAttributes)} and ${ownedBy(sql`${conversations.customAttributes}`, opts?.ownerPrincipalId)}`
    )
    .returning({ id: conversations.id })
  log.info({ deleted: rows.length }, 'test conversations deleted')
  return rows.length
}

async function sweepBatches(statement: () => SQL, batchSize: number): Promise<number> {
  let deleted = 0
  for (;;) {
    const batch = getExecuteRows<{ id: string }>(await db.execute(statement())).length
    deleted += batch
    if (batch < batchSize) return deleted
  }
}

export async function sweepTestData(opts?: {
  olderThanDays?: number
  batchSize?: number
  ownerPrincipalId?: PrincipalId
}): Promise<{ conversations: number; posts: number }> {
  const olderThanDays = opts?.olderThanDays ?? TEST_DATA_RETENTION_DAYS
  const batchSize = opts?.batchSize ?? 500
  const cutoffIso = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
  const owner = opts?.ownerPrincipalId

  const conversationCount = await sweepBatches(
    () => sql`
      DELETE FROM conversations WHERE id IN (
        SELECT id FROM conversations
        WHERE ${isTestThreadSql(sql`custom_attributes`)}
          AND ${ownedBy(sql`custom_attributes`, owner)}
          AND created_at < ${cutoffIso}::timestamptz
        LIMIT ${batchSize}
      )
      RETURNING id`,
    batchSize
  )
  const postCount = await sweepBatches(
    () => sql`
      DELETE FROM posts WHERE id IN (
        SELECT id FROM posts
        WHERE ${isTestThreadSql(sql`widget_metadata`)}
          AND ${ownedBy(sql`widget_metadata`, owner)}
          AND created_at < ${cutoffIso}::timestamptz
        LIMIT ${batchSize}
      )
      RETURNING id`,
    batchSize
  )

  if (conversationCount + postCount > 0) {
    log.info(
      { conversations: conversationCount, posts: postCount, olderThanDays },
      'test data retention sweep deleted test rows'
    )
  }
  return { conversations: conversationCount, posts: postCount }
}
