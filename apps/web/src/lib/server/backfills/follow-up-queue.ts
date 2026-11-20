/**
 * A startup backfill's follow-up queue (`ticket-frt-reconcile`).
 *
 * Generic: a row names a backfill, and the handler runs the follow-up step that
 * backfill registers. With none registered it throws, so the row is retried
 * (with backoff) until a build that registers the step runs it.
 */
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { findBackfill, walkFollowUp } from './batched'
import { upgradeJob } from './upgrade-done'

export const runBackfillFollowUpJob = upgradeJob(async (job: ClaimedJob) => {
  const name = typeof job.payload.name === 'string' ? job.payload.name : null
  const entry = name === null ? undefined : findBackfill(name)
  if (!entry?.followUp || entry.followUp.queue !== job.queue) {
    throw new Error(`no follow-up step is registered on ${job.queue} for backfill ${name ?? '?'}`)
  }
  await walkFollowUp(entry)
})
