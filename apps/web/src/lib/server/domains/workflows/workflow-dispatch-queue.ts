/**
 * Durable workflow-trigger dispatch (support platform §4.6).
 *
 * Event processing used to call `dispatchWorkflowsForEvent` fire-and-forget
 * straight off the event: a crash or deploy in the window between the event
 * landing and that call finishing silently dropped the trigger. This queue
 * makes the call durable — the event is enqueued, a handler dispatches it, and
 * a failed attempt is retried.
 *
 * The interrupt-then-dispatch ordering (§4.6: a reply or close ends pending
 * waits before new workflows start) happens INSIDE `dispatchWorkflowsForEvent`,
 * so it holds within one job regardless of concurrency — that is intra-job
 * ordering, not a claim about the order two jobs run in.
 *
 * ## The ordering constraint, and how it survives the move
 *
 * Cross-event ordering is a property of the consumer. Two rapid events on the
 * SAME conversation (a reply then a close) are two separate jobs, and only a
 * serial consumer keeps their dispatch in enqueue order. Under BullMQ that was
 * `concurrency: 1`. Here it is `concurrency: 1` on the job definition, and the
 * mechanism is stronger than a worker option: the claim asks for exactly the
 * queue's free slots, so with one slot at most one dispatch job is ever
 * outstanding, and the claim's `ORDER BY run_at, id` hands them out in
 * insertion order. Per-conversation grouping remains the scaling lever if this
 * becomes a throughput bottleneck.
 *
 * One honest limit, unchanged from the reference: this is FIFO *per consuming
 * process*. Two worker replicas each hold one slot, so they can dispatch two
 * events concurrently. The Postgres claim at least makes their interleaving
 * ordered and atomic rather than dependent on Redis delivery order.
 *
 * ## The dedupe key, which did not work before
 *
 * The job was keyed `workflow-dispatch:${event.id}` so a re-enqueue of the same
 * event would dedupe rather than stack a second dispatch. **It never did.**
 * BullMQ rejects a custom id containing `:` unless it splits into exactly three
 * parts, and `workflow-dispatch:evt_01k…` is two — so every enqueue threw
 * `Custom Id cannot contain :`, the hook reported a retryable failure, and the
 * trigger was retried to exhaustion. Verified directly against the resolved
 * bullmq 5.74.1 before this queue moved. A `dedupe_key` column has no such
 * restriction, so the intent the comment always described is what now happens.
 */
import { enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import type { EventData } from '@/lib/server/events/types'
import { dispatchWorkflowsForEvent } from './event-trigger'

const log = logger.child({ component: 'workflow-dispatch-queue' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const WORKFLOW_DISPATCH_QUEUE = 'workflow-dispatch'

/** The idempotency handle for one event's dispatch. */
export function workflowDispatchDedupeKey(eventId: string): string {
  return `workflow-dispatch:${eventId}`
}

/**
 * Enqueue an event for durable workflow-trigger dispatch.
 *
 * Keyed by the event's own id, so re-enqueuing the same event after a partial
 * failure is a no-op rather than a second dispatch.
 */
export async function enqueueWorkflowDispatch(event: EventData): Promise<void> {
  await enqueueJob({
    queue: WORKFLOW_DISPATCH_QUEUE,
    payload: { event: event as unknown as Record<string, unknown> },
    dedupeKey: workflowDispatchDedupeKey(String(event.id)),
    maxAttempts: 3,
  })
}

/** Dispatch every workflow triggered by one event. */
export async function runWorkflowDispatch(job: ClaimedJob): Promise<void> {
  const event = (job.payload as { event?: EventData }).event
  if (!event) {
    log.error({ jobId: job.jobId }, 'workflow dispatch job carried no event')
    return
  }
  await dispatchWorkflowsForEvent(event)
}
