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
  return aiTokensInUtcMonth(new Date())
}

/** Sum successful chat-completion tokens in the UTC month containing `at`. */
export async function aiTokensInUtcMonth(at: Date): Promise<number> {
  const start = utcMonthStart(at)
  const end = utcNextMonthStart(at)
  const result = await db.execute(sql`
    SELECT coalesce(sum(total_tokens), 0)::bigint AS total
    FROM ai_usage_log
    WHERE created_at >= ${start.toISOString()}::timestamptz
      AND created_at < ${end.toISOString()}::timestamptz
      AND call_type = 'chat_completion'
      AND status = 'success'
  `)
  const rows = result as unknown as Array<{ total: string | number }>
  return Number(rows[0]?.total ?? 0)
}

function utcMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
}

function utcNextMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
}
