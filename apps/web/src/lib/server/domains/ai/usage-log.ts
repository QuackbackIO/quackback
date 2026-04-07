/**
 * AI usage logging — records token usage, timing, and retry counts
 * for every AI API call in the feedback pipeline.
 *
 * Also handles retention cleanup for ai_usage_log and pipeline_log tables.
 */

import { db, aiUsageLog, sql } from '@/lib/server/db'

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
    pipelineStep: params.pipelineStep,
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
 * Wraps a withRetry call to automatically log AI usage.
 *
 * Usage:
 *   const result = await withUsageLogging(
 *     { pipelineStep: 'extraction', callType: 'chat_completion', model: MODEL, rawFeedbackItemId },
 *     () => withRetry(() => openai.chat.completions.create(...)),
 *     (result) => ({ inputTokens: ..., outputTokens: ..., totalTokens: ... })
 *   )
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
  fn: () => Promise<{ result: T; retryCount: number }>,
  extractUsage: (result: T) => { inputTokens: number; outputTokens?: number; totalTokens: number }
): Promise<T> {
  const start = Date.now()
  try {
    const { result, retryCount } = await fn()
    const usage = extractUsage(result)
    const durationMs = Date.now() - start

    void logAiUsage({
      ...params,
      ...usage,
      durationMs,
      retryCount,
      status: 'success',
    }).catch((err) => {
      console.warn('[AiUsageLog] Failed to log usage:', err)
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
      console.warn(`[AiUsageLog] Failed to log error entry: ${logErr}`)
    })

    throw error
  }
}

// ---------------------------------------------------------------------------
// Retention cleanup
// ---------------------------------------------------------------------------

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
