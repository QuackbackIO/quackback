import { db } from '@/lib/server/db'
import { sql } from 'drizzle-orm'

/**
 * Sum of total_tokens (input + output) for successful chat completions in the
 * current calendar month, the usage the aiTokensPerMonth allowance and the
 * usage report measure. Embeddings are recorded in ai_usage_log for visibility
 * but do not count toward the allowance.
 *
 * Served by ai_usage_log_created_idx on created_at; the table keeps 90 days.
 */
export async function aiTokensThisMonth(): Promise<number> {
  return aiTokensInUtcMonth(new Date())
}

/** Sum successful AI tokens in the UTC month containing `at`. */
export async function aiTokensInUtcMonth(at: Date): Promise<number> {
  return aiTokensInWindow(utcMonthStart(at), utcNextMonthStart(at))
}

/**
 * Sum successful tokens in [start, end). The allowance gate passes the window
 * from `ai-budget.ts`, which is a trial's whole span while one is running.
 */
export async function aiTokensInWindow(start: Date, end: Date): Promise<number> {
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

export function utcMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
}

export function utcNextMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
}
