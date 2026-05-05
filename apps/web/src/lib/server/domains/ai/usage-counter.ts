import { db } from '@/lib/server/db'
import { sql } from 'drizzle-orm'

/**
 * Sum of total_tokens (input + output) for successful chat-completion
 * calls in the current calendar month. Backs the aiTokensPerMonth tier
 * quota. Embeddings are excluded (call_type != 'chat_completion').
 *
 * Served by the partial index ai_usage_log_month_chat_idx on created_at
 * with WHERE call_type='chat_completion' AND status='success'.
 */
export async function aiTokensThisMonth(): Promise<number> {
  const result = await db.execute(sql`
    SELECT coalesce(sum(total_tokens), 0)::bigint AS total
    FROM ai_usage_log
    WHERE created_at >= date_trunc('month', now())
      AND created_at < date_trunc('month', now() + interval '1 month')
      AND call_type = 'chat_completion'
      AND status = 'success'
  `)
  const rows = result as unknown as Array<{ total: string | number }>
  // bigint comes back as string from postgres-js
  return Number(rows[0]?.total ?? 0)
}
