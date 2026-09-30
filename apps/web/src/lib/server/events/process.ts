/**
 * Event processing — the producer side of the `events` queue.
 *
 * Hooks are delivered by the Postgres job queue (`jobs/`), whose handler lives
 * in `hook-job.ts`. This module writes the event to the durable outbox and
 * offers the two enqueue shapes the rest of the system needs: the relay's bulk,
 * deterministically-keyed enqueue, and the scheduler's cancelable delayed one.
 *
 * A failed delivery is not lost: the job row keeps its `last_error` and its
 * attempt count, and terminal rows are retained per queue (30 days for a failed
 * `events` job) so *"did this webhook actually fire?"* stays answerable —
 * `SELECT … FROM job_queue WHERE queue = 'events'` in place of what used to be
 * a Redis failed-set inspection.
 */

import { cancelJob, enqueueJob, enqueueJobs } from '@/lib/server/jobs/job-queue'
import { queueHookSync } from '@/lib/server/integrations/sync/hooks'
import { HOOK_RETRY_ATTEMPTS } from './retry-schedule'
import type { HookJobData } from './hook-job'
import type { EventData } from './types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'event-process' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const EVENTS_QUEUE = 'events'

export type { HookJobData }

/**
 * Process an event by resolving targets and enqueuing hooks.
 * Target resolution is awaited (~10-50ms). Hook execution runs in the background.
 */
export async function processEvent(event: EventData): Promise<void> {
  // EVENTING-V2 cutover: workflow triggers now ride the outbox → relay →
  // 'workflow' hook (workflowTriggerResolver), so the legacy fire-and-forget
  // enqueue-into-the-workflow-queue branch that used to live here is gone. The
  // outbox makes the trigger durable up to the workflow engine's own dispatch
  // queue — closing the crash window the old branch could drop a trigger in.

  // EVENTING-V2 (WO-18 cutover): the durable outbox is the ONLY path. The event
  // is written transactionally (closing the commit-vs-enqueue loss window) and
  // `event-dispatch` resolves targets and enqueues onto the `events` queue.
  // The legacy direct getHookTargets + bulk-add path is deleted. The write also
  // queues the event's reactions (SLA clocks, pair-ticket reopen, CSAT confirm,
  // close summaries; see event-reactions.ts), so nothing reacts in-process.
  const { writeEventToOutbox } = await import('./outbox-dispatch')
  await writeEventToOutbox(event)
}

/**
 * Route integration targets through the durable sync ledger; ordinary hooks
 * retain the event queue. The relay can supply its transaction so its receipt
 * and all delivery intents commit together. Stable operation keys survive
 * queue pruning, while ordinary jobs deduplicate by the relay's jobId.
 */
export async function enqueueHookJobsWithIds(
  jobs: Array<{ name: string; data: HookJobData; jobId: string }>,
  opts?: { executor?: import('@/lib/server/jobs/job-queue').JobSqlExecutor }
): Promise<void> {
  if (jobs.length === 0) return
  const ordinary = jobs.filter(({ data }) => typeof data.config.integrationId !== 'string')
  for (const { data } of jobs) {
    if (typeof data.config.integrationId === 'string') await queueHookSync(data, opts?.executor)
  }
  if (!ordinary.length) return
  await enqueueJobs(
    ordinary.map(({ data, jobId }) => ({
      queue: EVENTS_QUEUE,
      payload: data as unknown as Record<string, unknown>,
      dedupeKey: jobId,
      maxAttempts: HOOK_RETRY_ATTEMPTS,
    })),
    opts
  )
}

// ============================================================================
// Delayed Job Helpers
// ============================================================================

/**
 * Schedule a job to run later.
 *
 * A delayed job is a row whose `run_at` is in the future, so it survives a
 * restart by construction — the reference kept it in Redis, where a flush lost
 * it. Used for scheduled changelog publishing and the status-page maintenance
 * window boundaries.
 */
export async function addDelayedJob(
  name: string,
  data: HookJobData,
  opts?: { delay?: number; jobId?: string }
): Promise<void> {
  const delay = Math.max(0, opts?.delay ?? 0)
  await enqueueJob({
    queue: EVENTS_QUEUE,
    payload: { ...data, jobName: name } as unknown as Record<string, unknown>,
    dedupeKey: opts?.jobId ?? null,
    runAt: new Date(Date.now() + delay),
    maxAttempts: HOOK_RETRY_ATTEMPTS,
  })
}

/**
 * Remove a delayed job by its key. Silent when the job does not exist (already
 * executed, or never created); a job that is *running* is deliberately not
 * removable — its lease is what adjudicates its result.
 */
export async function removeDelayedJob(jobId: string): Promise<void> {
  const removed = await cancelJob(EVENTS_QUEUE, jobId)
  if (removed > 0) log.debug({ job_id: jobId, removed }, 'removed delayed job')
}
