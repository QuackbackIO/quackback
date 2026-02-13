/**
 * Generic event scheduling — deferred event dispatch via BullMQ.
 *
 * Domain code calls scheduleDispatch/cancelScheduledDispatch without
 * knowing anything about BullMQ. The delayed job handler (process.ts)
 * re-fetches state from DB before dispatching to handle races.
 */

import type { EventActor } from './types'
import { addDelayedJob, removeDelayedJob } from './process'

export interface ScheduleDispatchInput {
  /** Unique job ID — used for idempotent upsert and cancellation. */
  jobId: string
  /** Callback identifier the worker routes on (e.g. '__changelog_publish__'). */
  handler: string
  /** Delay in milliseconds from now until the job should fire. */
  delayMs: number
  /** Arbitrary payload the handler receives. */
  payload: Record<string, unknown>
  /** Actor to attribute the eventual event to (optional — handler can default). */
  actor?: EventActor
}

/**
 * Schedule a deferred event dispatch.
 * If a job with the same `jobId` already exists it is replaced.
 */
export async function scheduleDispatch(input: ScheduleDispatchInput): Promise<void> {
  // Cancel any existing job first to allow rescheduling
  await cancelScheduledDispatch(input.jobId)

  await addDelayedJob(
    input.handler,
    {
      hookType: input.handler,
      // The event/target fields aren't used by sentinel handlers —
      // they read everything they need from config.payload.
      event: null as never,
      target: null,
      config: { ...input.payload, actor: input.actor },
    },
    { delay: input.delayMs, jobId: input.jobId }
  )
}

/**
 * Cancel a previously scheduled dispatch by its job ID.
 * No-op if the job has already fired or was never created.
 */
export async function cancelScheduledDispatch(jobId: string): Promise<void> {
  await removeDelayedJob(jobId)
}
