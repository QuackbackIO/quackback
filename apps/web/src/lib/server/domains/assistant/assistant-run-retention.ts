/**
 * Retention for Quinn's run history (QUINN-PRODUCT Step 11, P8).
 *
 * The specification asks for one retention policy over run steps, evidence
 * excerpts and tool results together, and this is the half those first two
 * needed: `assistant_tool_calls` already ages out at 180 days beside
 * `ai_usage_log` on the daily maintenance sweep, and this pass joins it in the
 * same `logs_retention` lock so all three are one decision rather than three.
 *
 * ## What is reclaimed, and what is not
 *
 * Steps and evidence are DELETED past the window. They are the bulky, most
 * revealing part of a run: an evidence row carries the exact passage handed to
 * the model, which is a copy of source text, and a step's output carries the
 * shape of a generation. Neither is read after the run is settled except by a
 * person inspecting it, and nobody inspects a quarter-old turn.
 *
 * The `assistant_runs` row itself is KEPT, deliberately, following
 * workflow-retention.ts's reading of the same question: the run is the outcome
 * ledger the Improve page counts, and deleting it would silently move a
 * historical failure rate. It is small, it carries no passage and no transcript,
 * and it goes when its conversation goes.
 *
 * ## Deleting a customer's history
 *
 * That is not this pass's job and must not be. `assistant_runs.conversation_id`
 * cascades, steps and evidence cascade off the run, `assistant_tool_calls` and
 * `assistant_regression_cases` cascade off the conversation, so erasing a
 * conversation erases every record of Quinn's work on it in the same statement.
 * A cleanup pass that had to be remembered would be the wrong mechanism for a
 * promise like that; the foreign keys are asserted directly instead.
 *
 * The window is ninety days, matching `ai_usage_log`'s own
 * AI_USAGE_RETENTION_DAYS rather than the tool audit's 180: a receipt is the
 * record of a real side effect and is worth keeping twice as long, while a
 * passage is telemetry about how an answer was assembled.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'

const log = logger.child({ component: 'assistant-run-retention' })

/** How long a run's steps and evidence excerpts are kept. */
export const ASSISTANT_RUN_HISTORY_RETENTION_DAYS = 90

export interface AssistantRunHistoryRetentionResult {
  steps: number
  evidence: number
}

/**
 * Delete in batches until a pass returns less than a full one.
 *
 * The same idiom workflow-retention.ts and conversation.spam-retention.ts use,
 * and for the same reason: one unbounded DELETE against a long-neglected
 * backlog holds its lock and WAL cost for a single enormous statement.
 */
async function sweepTable(
  table: 'assistant_run_steps' | 'assistant_run_evidence',
  column: 'started_at' | 'created_at',
  cutoffIso: string,
  batchSize: number,
  exec: Executor
): Promise<number> {
  let deleted = 0
  for (;;) {
    const result = await exec.execute(sql`
      DELETE FROM ${sql.raw(table)}
      WHERE id IN (
        SELECT id FROM ${sql.raw(table)}
        WHERE ${sql.raw(column)} < ${cutoffIso}::timestamptz
        LIMIT ${batchSize}
      )
      RETURNING id
    `)
    const batch = getExecuteRows<{ id: string }>(result).length
    deleted += batch
    if (batch < batchSize) break
  }
  return deleted
}

/**
 * Reclaim run steps and run evidence older than the window.
 *
 * Registered on the daily maintenance sweep (`cron/fleet-jobs.ts`) alongside
 * `cleanupExpiredToolCalls`, under the same `logs_retention` lock.
 */
export async function sweepExpiredAssistantRunHistory(opts?: {
  olderThanDays?: number
  batchSize?: number
  exec?: Executor
}): Promise<AssistantRunHistoryRetentionResult> {
  const olderThanDays = opts?.olderThanDays ?? ASSISTANT_RUN_HISTORY_RETENTION_DAYS
  const batchSize = opts?.batchSize ?? 500
  const exec = opts?.exec ?? db
  const cutoffIso = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()

  const evidence = await sweepTable(
    'assistant_run_evidence',
    'created_at',
    cutoffIso,
    batchSize,
    exec
  )
  const steps = await sweepTable('assistant_run_steps', 'started_at', cutoffIso, batchSize, exec)

  if (steps > 0 || evidence > 0) {
    log.info({ steps, evidence, olderThanDays }, 'assistant run history retention sweep complete')
  }
  return { steps, evidence }
}
