/**
 * Import commit queue (§I1) — the async side of the CSV import pipeline.
 *
 * **A single attempt per job, and that is the whole design.** A retry with no
 * idempotence tracking (§I2 adds source-id matching) would re-run the whole
 * batch and double-import rows that already landed before the failure. Failures
 * are reported on the run row (`status='failed'`) instead — safer than a silent
 * partial re-run.
 *
 * On the Postgres queue that property is `maxAttempts: 1`, which the claim
 * spends by incrementing `attempts` *before* the handler runs. So a process
 * killed at any point during the import leaves a row the reaper makes terminal
 * rather than handing back: at most once, including across a SIGKILL. See
 * `jobs/JOBS.md` §2 and the kill matrix that measures it.
 *
 * The run row was always the real queue entry here — it carries the status the
 * UI polls — so the job row holds only the id needed to find it again.
 */
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { runImportCommitJob } from './import-run-processor'
import { logger } from '@/lib/server/logger'
import type { ImportCommitJobData } from './import-run-processor'

const log = logger.child({ component: 'import-queue' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const IMPORT_QUEUE = 'import'

/** Enqueue a commit job. Returns once the row is committed (not once it runs). */
export async function enqueueImportCommitJob(data: ImportCommitJobData): Promise<void> {
  await enqueueJob({
    queue: IMPORT_QUEUE,
    payload: { ...data },
    // Stated here as well as on the definition. The definition is what the
    // scheduler and the claim read; this is what a reader of the import path
    // sees, and the property is too costly to leave implicit in one place.
    maxAttempts: 1,
  })
}

/** Run one import commit. */
export async function runImportCommit(job: ClaimedJob): Promise<void> {
  const data = job.payload as unknown as ImportCommitJobData
  try {
    await runImportCommitJob(data)
  } catch (err) {
    log.error({ err, run_id: data.runId }, 'import commit job failed permanently')
    throw err
  }
}
