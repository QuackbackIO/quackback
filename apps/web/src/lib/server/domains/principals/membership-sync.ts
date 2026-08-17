/**
 * Enqueue the workspace membership-sync job.
 *
 * The control plane's "your workspaces" screen is an index of this
 * workspace's team. Membership is decided here; the job reads the current
 * roster and pushes the desired seat set. Rapid edits share one minute-bucket
 * dedupe key so they coalesce into a single push. A later minute is a new
 * key, so a change after a successful sync is not swallowed by the spent row.
 */
import { enqueueJob, type JobSqlExecutor } from '@/lib/server/jobs/job-queue'

export const MEMBERSHIP_SYNC_QUEUE = 'membership-sync'
export const MEMBERSHIP_SYNC_MAX_ATTEMPTS = 3

const MINUTE_MS = 60_000

/** Deterministic coalesce window. Exported so tests can name the key. */
export function membershipSyncDedupeKey(now = Date.now()): string {
  return `${MEMBERSHIP_SYNC_QUEUE}:${Math.floor(now / MINUTE_MS)}`
}

export async function enqueueMembershipSync(opts?: { executor?: JobSqlExecutor }): Promise<void> {
  await enqueueJob({
    queue: MEMBERSHIP_SYNC_QUEUE,
    payload: {},
    dedupeKey: membershipSyncDedupeKey(),
    maxAttempts: MEMBERSHIP_SYNC_MAX_ATTEMPTS,
    executor: opts?.executor,
  })
}
