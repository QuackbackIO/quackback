/**
 * Enqueue the workspace membership-sync job.
 *
 * The control plane's "your workspaces" screen is an index of this
 * workspace's team. Membership is decided here; the job reads the current
 * roster and pushes the desired seat set.
 *
 * One stable dedupe key for the workspace. In-flight (pending / running)
 * rows coalesce: a second enqueue is a no-op. A spent row is cancelled
 * first so a change after a successful push is not swallowed.
 */
import { cancelJob, enqueueJob, type JobSqlExecutor } from '@/lib/server/jobs/job-queue'

export const MEMBERSHIP_SYNC_QUEUE = 'membership-sync'
export const MEMBERSHIP_SYNC_DEDUPE_KEY = 'membership-sync'
export const MEMBERSHIP_SYNC_MAX_ATTEMPTS = 10
export const MEMBERSHIP_SYNC_RETRY_BACKOFF_MS = 15 * 60_000

/** Stable coalesce key. Exported so tests can name the row. */
export function membershipSyncDedupeKey(): string {
  return MEMBERSHIP_SYNC_DEDUPE_KEY
}

export async function enqueueMembershipSync(opts?: { executor?: JobSqlExecutor }): Promise<void> {
  const executor = opts?.executor
  await cancelJob(MEMBERSHIP_SYNC_QUEUE, MEMBERSHIP_SYNC_DEDUPE_KEY, {
    executor,
    terminalOnly: true,
  })
  await enqueueJob({
    queue: MEMBERSHIP_SYNC_QUEUE,
    payload: {},
    dedupeKey: MEMBERSHIP_SYNC_DEDUPE_KEY,
    maxAttempts: MEMBERSHIP_SYNC_MAX_ATTEMPTS,
    executor,
  })
}
