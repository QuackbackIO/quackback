/**
 * Retention cleanup for ai_usage_log and pipeline_log tables.
 *
 * Deletes expired rows on a daily schedule:
 * - ai_usage_log: 90 days (high volume, cost data has diminishing value)
 * - pipeline_log: 180 days (lower volume, audit trail has longer-term value)
 */

import { db, sql } from '@/lib/server/db'

const AI_USAGE_RETENTION_DAYS = 90
const PIPELINE_LOG_RETENTION_DAYS = 180

export async function cleanupExpiredLogs(): Promise<{
  aiUsageDeleted: number
  pipelineDeleted: number
}> {
  const aiResult = await db.execute(
    sql`DELETE FROM ai_usage_log WHERE created_at < now() - interval '${sql.raw(String(AI_USAGE_RETENTION_DAYS))} days'`
  )

  const pipelineResult = await db.execute(
    sql`DELETE FROM pipeline_log WHERE created_at < now() - interval '${sql.raw(String(PIPELINE_LOG_RETENTION_DAYS))} days'`
  )

  const aiUsageDeleted = (aiResult as { count: number }).count ?? 0
  const pipelineDeleted = (pipelineResult as { count: number }).count ?? 0

  if (aiUsageDeleted > 0 || pipelineDeleted > 0) {
    console.log(
      `[Retention] Cleaned up ${aiUsageDeleted} ai_usage_log rows (>${AI_USAGE_RETENTION_DAYS}d), ` +
        `${pipelineDeleted} pipeline_log rows (>${PIPELINE_LOG_RETENTION_DAYS}d)`
    )
  }

  return { aiUsageDeleted, pipelineDeleted }
}
