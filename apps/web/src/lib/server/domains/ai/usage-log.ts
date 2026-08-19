/**
 * AI usage logging — records token usage, timing, and retry counts
 * for every AI API call.
 *
 * Also handles retention cleanup for the ai_usage_log table and a few
 * operational tables.
 */

import { db, aiUsageLog, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ai-usage-log' })

export interface LogAiUsageParams {
  pipelineStep: string
  callType: 'chat_completion' | 'embedding'
  model: string
  rawFeedbackItemId?: string
  signalId?: string
  postId?: string
  inputTokens: number
  outputTokens?: number
  totalTokens: number
  durationMs: number
  retryCount?: number
  status?: 'success' | 'error'
  error?: string
  metadata?: Record<string, unknown>
}

export async function logAiUsage(params: LogAiUsageParams): Promise<void> {
  await db.insert(aiUsageLog).values({
    // Clamped to the column's varchar(30): an over-long step label must cost
    // us a few characters, never the row — and inside a wrapping transaction
    // (tests, evals) a failed insert would abort the whole transaction.
    pipelineStep: params.pipelineStep.slice(0, 30),
    callType: params.callType,
    model: params.model,
    rawFeedbackItemId: (params.rawFeedbackItemId ??
      null) as typeof aiUsageLog.$inferInsert.rawFeedbackItemId,
    signalId: (params.signalId ?? null) as typeof aiUsageLog.$inferInsert.signalId,
    postId: (params.postId ?? null) as typeof aiUsageLog.$inferInsert.postId,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens ?? null,
    totalTokens: params.totalTokens,
    durationMs: params.durationMs,
    retryCount: params.retryCount ?? 0,
    status: params.status ?? 'success',
    error: params.error ?? null,
    metadata: params.metadata ?? null,
  })
}

/**
 * Outcome classification AI answer surfaces record in metadata.answerKind.
 * Per model call — unrelated to the assistant_involvements status vocabulary,
 * which classifies whole conversations rather than individual attempts.
 */
export type AiAnswerKind = 'answered' | 'no_answer' | 'no_sources' | 'escalated' | 'invalid_output'

/**
 * Wraps a withRetry call to automatically log AI usage.
 *
 * Usage:
 *   const result = await withUsageLogging(
 *     { pipelineStep: 'extraction', callType: 'chat_completion', model: MODEL, rawFeedbackItemId },
 *     () => withRetry(() => openai.chat.completions.create(...)),
 *     (result) => ({ inputTokens: ..., outputTokens: ..., totalTokens: ... })
 *   )
 *
 * `fn` may return `metadata` for outcome fields only known after the call
 * resolves (e.g. answerKind); it is merged over the params metadata in the
 * logged row.
 */
export async function withUsageLogging<T>(
  params: Omit<
    LogAiUsageParams,
    | 'durationMs'
    | 'inputTokens'
    | 'outputTokens'
    | 'totalTokens'
    | 'status'
    | 'error'
    | 'retryCount'
  >,
  fn: () => Promise<{ result: T; retryCount: number; metadata?: Record<string, unknown> }>,
  extractUsage: (result: T) => { inputTokens: number; outputTokens?: number; totalTokens: number }
): Promise<T> {
  const start = Date.now()
  try {
    const { result, retryCount, metadata: outcomeMetadata } = await fn()
    const usage = extractUsage(result)
    const durationMs = Date.now() - start

    void logAiUsage({
      ...params,
      ...(outcomeMetadata ? { metadata: { ...params.metadata, ...outcomeMetadata } } : {}),
      ...usage,
      durationMs,
      retryCount,
      status: 'success',
    }).catch((err) => {
      log.warn({ err }, 'failed to log ai usage')
    })

    return result
  } catch (error) {
    const durationMs = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Extract retryCount from withRetry's error context if available
    const retryCount =
      error instanceof Error && 'retryCount' in error
        ? (error as Error & { retryCount: number }).retryCount
        : undefined

    await logAiUsage({
      ...params,
      inputTokens: 0,
      totalTokens: 0,
      durationMs,
      retryCount,
      status: 'error',
      error: errorMessage,
    }).catch((logErr) => {
      log.warn({ err: logErr }, 'failed to log ai usage error entry')
    })

    throw error
  }
}

// ---------------------------------------------------------------------------
// Retention cleanup
// ---------------------------------------------------------------------------

export const AI_USAGE_RETENTION_DAYS = 90

export async function cleanupExpiredLogs(): Promise<{
  aiUsageDeleted: number
  operationalDeleted: number
}> {
  const aiResult = await db.execute(
    sql`DELETE FROM ai_usage_log WHERE created_at < now() - interval '${sql.raw(String(AI_USAGE_RETENTION_DAYS))} days'`
  )

  const aiUsageDeleted = (aiResult as { count: number }).count ?? 0
  const operationalResult = await db.execute(sql`
    WITH deleted_hooks AS (
      DELETE FROM hook_deliveries WHERE processed_at < now() - interval '7 days' RETURNING 1
    ), deleted_tokens AS (
      DELETE FROM unsubscribe_tokens
      WHERE expires_at < now() - interval '30 days' OR used_at < now() - interval '30 days'
      RETURNING 1
    ), deleted_notifications AS (
      DELETE FROM in_app_notifications
      WHERE created_at < now() - interval '365 days'
         OR (archived_at IS NOT NULL AND archived_at < now() - interval '90 days')
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM deleted_hooks)
      + (SELECT count(*) FROM deleted_tokens)
      + (SELECT count(*) FROM deleted_notifications) AS count
  `)
  const [operationalRow] = Array.from(operationalResult as Iterable<{ count: number }>)
  const operationalDeleted = Number(operationalRow?.count ?? 0)

  if (aiUsageDeleted > 0 || operationalDeleted > 0) {
    log.info(
      {
        ai_usage_deleted: aiUsageDeleted,
        operational_deleted: operationalDeleted,
        ai_usage_retention_days: AI_USAGE_RETENTION_DAYS,
      },
      'retention cleanup completed'
    )
  }

  return { aiUsageDeleted, operationalDeleted }
}
