import { db } from '@/lib/server/db'
import { sql } from 'drizzle-orm'

/**
 * Count successful chat-completion calls in the current calendar month.
 * Backs the aiOpsPerMonth tier quota. Embeddings are excluded
 * (call_type != 'chat_completion'), failed calls are excluded
 * (status != 'success').
 *
 * Should be served by the partial index ai_usage_log_month_chat_idx
 * (migration 0051) for fast monthly aggregation.
 */
export async function aiOpsThisMonth(): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM ai_usage_log
    WHERE created_at >= date_trunc('month', now())
      AND created_at < date_trunc('month', now() + interval '1 month')
      AND call_type = 'chat_completion'
      AND status = 'success'
  `)
  // db.execute returns array-shaped rows under postgres-js.
  const rows = result as Array<{ count: number }>
  return rows[0]?.count ?? 0
}
