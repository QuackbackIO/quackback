/**
 * Pipeline audit log — records processing decisions, inputs/outputs,
 * and state transitions for every feedback item through the pipeline.
 */

import { db, pipelineLog } from '@/lib/server/db'

export interface LogPipelineEventParams {
  eventType: string
  rawFeedbackItemId?: string
  signalId?: string
  suggestionId?: string
  postId?: string
  detail: Record<string, unknown>
}

export async function logPipelineEvent(params: LogPipelineEventParams): Promise<void> {
  try {
    if (!pipelineLog) return // Table not yet exported from schema
    await db.insert(pipelineLog).values({
      eventType: params.eventType,
      rawFeedbackItemId: (params.rawFeedbackItemId ??
        null) as typeof pipelineLog.$inferInsert.rawFeedbackItemId,
      signalId: (params.signalId ?? null) as typeof pipelineLog.$inferInsert.signalId,
      suggestionId: (params.suggestionId ?? null) as typeof pipelineLog.$inferInsert.suggestionId,
      postId: (params.postId ?? null) as typeof pipelineLog.$inferInsert.postId,
      detail: params.detail,
    })
  } catch (err) {
    console.warn('[pipeline-log] Failed to log event:', params.eventType, err)
  }
}
