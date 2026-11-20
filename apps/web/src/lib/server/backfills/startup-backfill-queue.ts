/**
 * The `startup-backfill` queue: its handler and its schedule gate, in one module
 * so priming loads both before any workspace scope is open.
 */
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { TerminalJobError } from '@/lib/server/jobs/definitions'
import { enqueueBackfillPass, findBackfill, startupBackfillDue, walkBackfill } from './batched'
import { upgradeJob } from './upgrade-done'

export { startupBackfillDue }

/** A scheduled row (no `name`) runs the enqueue pass; a row for a backfill walks it. */
export const runStartupBackfillJob = upgradeJob(async (job: ClaimedJob) => {
  const name = typeof job.payload.name === 'string' ? job.payload.name : null
  if (name === null) {
    await enqueueBackfillPass()
    return
  }
  const entry = findBackfill(name)
  if (!entry) throw new TerminalJobError(`no startup backfill is registered as ${name}`)
  await walkBackfill(entry)
})
