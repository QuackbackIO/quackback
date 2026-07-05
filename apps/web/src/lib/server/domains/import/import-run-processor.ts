/**
 * Async import commit job (§I1).
 *
 * Owns an import run's running -> completed|failed transition. Kept separate
 * from the BullMQ wrapper (`import-queue.ts`) so the orchestration itself is
 * unit-testable without Redis: the worker's job handler is a thin call into
 * `runImportCommitJob`.
 */
import type { ImportRunId } from '@quackback/ids'
import type { ImportRunSource } from '@/lib/server/db'
import type { ImportInput } from './types'
import { processImport } from './import-service'
import {
  ensureBatchTag,
  markImportRunRunning,
  completeImportRun,
  failImportRun,
} from './import-run.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'import-run-processor' })

export interface ImportCommitJobData {
  runId: ImportRunId
  source: ImportRunSource
  input: ImportInput
}

/**
 * Executed by the queue worker. Creates (or reuses) the day's batch tag,
 * flips the run to `running`, delegates to the existing CSV pipeline, then
 * writes back totals + the capped error report. A thrown error anywhere in
 * this path fails the run rather than the process — the worker registry's
 * job-level retry is disabled for this queue (see import-queue.ts): source-id
 * idempotence only covers rows that carry one, so a blind retry could still
 * double-import the rest of the batch.
 */
export async function runImportCommitJob(data: ImportCommitJobData): Promise<void> {
  const { runId, source, input } = data
  try {
    const batchTag = await ensureBatchTag(source)
    await markImportRunRunning(runId, batchTag.id)

    const result = await processImport({ ...input, batchTagId: batchTag.id })

    await completeImportRun(
      runId,
      {
        rows: input.totalRows,
        created: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
      },
      result.errors
    )
  } catch (error) {
    log.error({ err: error, run_id: runId }, 'import commit job failed')
    await failImportRun(runId, error instanceof Error ? error.message : 'Import failed')
  }
}
