/**
 * Workspace export queue — the async ZIP build.
 *
 * **A single attempt per job**, same reasoning as import: a blind retry would
 * redo minutes of work and could double-upload. Failures land on the run row
 * (`status='failed'`) instead. On the Postgres queue that is `maxAttempts: 1`,
 * spent by the claim rather than by completion, so a process killed mid-build
 * leaves a job the reaper makes terminal rather than handing back.
 *
 * Concurrency 1 — exports are heavy, and the single-active-run unique index
 * already guarantees one at a time.
 */
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { runWorkspaceExportJob } from './export-run-processor'
import { logger } from '@/lib/server/logger'
import type { WorkspaceExportJobData } from './export-run-processor'

const log = logger.child({ component: 'export-queue' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const EXPORT_QUEUE = 'export'

/** Enqueue an export job. Returns once the row is committed (not once it runs). */
export async function enqueueWorkspaceExportJob(data: WorkspaceExportJobData): Promise<void> {
  await enqueueJob({
    queue: EXPORT_QUEUE,
    payload: { ...data },
    maxAttempts: 1,
  })
}

/** Build one workspace export. */
export async function runWorkspaceExport(job: ClaimedJob): Promise<void> {
  const data = job.payload as unknown as WorkspaceExportJobData
  try {
    await runWorkspaceExportJob(data)
  } catch (err) {
    log.error({ err, run_id: data.runId }, 'workspace export job failed permanently')
    throw err
  }
}
