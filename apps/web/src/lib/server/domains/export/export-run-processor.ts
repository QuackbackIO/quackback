/**
 * Async workspace export job.
 *
 * Owns an export run's running -> completed|failed transition. Kept separate
 * from the BullMQ wrapper (`export-queue.ts`) so the orchestration itself is
 * unit-testable without Redis: the worker's job handler is a thin call into
 * `runWorkspaceExportJob`.
 */
import type { ExportRunId } from '@quackback/ids'
import { buildWorkspaceExport, cleanupExpiredExports } from './workspace-export'
import { markExportRunRunning, completeExportRun, failExportRun } from './export-run.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export-run-processor' })

export interface WorkspaceExportJobData {
  runId: ExportRunId
  /** Workspace slug, captured at request time for the manifest. */
  workspaceSlug: string
}

/**
 * Executed by the queue worker. Flips the run to `running`, builds + uploads
 * the ZIP, then writes back size and per-entity counts. A thrown error fails
 * the run rather than the process (queue is attempts: 1). Expired-artifact
 * cleanup runs either way — best effort, never masks the run's own outcome.
 */
export async function runWorkspaceExportJob(data: WorkspaceExportJobData): Promise<void> {
  const { runId, workspaceSlug } = data
  try {
    await markExportRunRunning(runId)
    const result = await buildWorkspaceExport(runId, workspaceSlug)
    await completeExportRun(runId, result)
  } catch (error) {
    log.error({ err: error, run_id: runId }, 'workspace export job failed')
    await failExportRun(runId, error instanceof Error ? error.message : 'Export failed')
  }

  try {
    await cleanupExpiredExports()
  } catch (error) {
    log.error({ err: error }, 'export cleanup failed')
  }
}
