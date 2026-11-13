/**
 * The `deferred-index-build` queue: its handler and its schedule gate, in one
 * module so priming loads both before any workspace scope is open.
 */
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { TerminalJobError } from '@/lib/server/jobs/definitions'
import {
  buildDeferredIndex,
  deferredIndexBuildDue,
  deferredIndexSpecs,
  enqueueDeferredIndexBuilds,
} from './deferred-indexes'
import { upgradeJob } from './upgrade-done'

export { deferredIndexBuildDue }

/** A scheduled row (no `index`) runs the pass; a row for an index builds that one index. */
export const runDeferredIndexJob = upgradeJob(async (job: ClaimedJob) => {
  const index = typeof job.payload.index === 'string' ? job.payload.index : null
  if (index === null) {
    await enqueueDeferredIndexBuilds()
    return
  }
  const spec = deferredIndexSpecs().find((s) => s.name === index)
  if (!spec) throw new TerminalJobError(`${index} is not a background index of this build`)
  await buildDeferredIndex(spec)
})
