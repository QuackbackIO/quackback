/**
 * Where the relay puts a resolved hook job.
 *
 * ## Why this file exists at all, and why it should not exist for long
 *
 * The relay is the sole enqueuer for the highest-volume queue. Under
 * `QUACKBACK_TENANCY=single` that queue is BullMQ's `{event-hooks}`, and nothing
 * about it changes here.
 *
 * Under pooled tenancy it cannot be. Read from live Redis rather than from code:
 * fifteen BullMQ queues exist and **zero carry a tenant prefix**, while every
 * *application* Redis key does. So one un-namespaced list would hold every
 * tenant's hook payloads, and any consumer that ever attached — a stray
 * single-tenant replica sharing the Redis, a future worker — would drain all
 * tenants from one list with no tenant discriminator on the key. Today that
 * queue is safe **only because pooled startup skips the relay entirely**, which
 * is precisely the thing this piece removes. Starting the relay without moving
 * the sink would convert a durable per-tenant backlog into a fleet-shared one.
 *
 * So under pooled tenancy the relay writes into the **tenant's own Postgres job
 * queue** instead: same database as the outbox row it came from, same
 * transaction boundary properties, and `tenant_id` stamped from the ambient
 * scope and asserted again by the claim. There is no routing decision to get
 * wrong because there is no shared queue.
 *
 * **This is a shim with a known end date.** The queue-migration piece moves
 * `events` off BullMQ for both tenancy modes, at which point
 * `enqueueHookJobsWithIds` *is* this Postgres write and the branch below
 * collapses to a single call. The queue name and the dedupe key are chosen to
 * match that destination exactly (`events`, dedupe key = the relay's
 * deterministic job id), so rows written by this shim are claimable by that
 * piece's handler without translation, in either merge order.
 */
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { isPooledTenancy } from '@/lib/server/tenancy/mode'
import { enqueueHookJobsWithIds } from './process'
import { HOOK_RETRY_ATTEMPTS } from './retry-schedule'

/**
 * Queue name for hook delivery on the Postgres job tier.
 *
 * Deliberately the same string the queue-migration piece registers its `events`
 * definition under. A different name here would leave rows nobody claims.
 */
export const EVENTS_QUEUE = 'events'

export interface HookJob {
  name: string
  data: {
    hookType: string
    event: unknown
    target: unknown
    config: Record<string, unknown>
  }
  /** Deterministic: `${eventId}:${sink}:${targetKey}`. Re-draining re-enqueues the same id. */
  jobId: string
}

/**
 * Enqueue the relay's resolved hook jobs.
 *
 * Idempotent by the caller's job id under both modes: BullMQ's `addBulk` will
 * not re-add an existing id, and the Postgres path relies on
 * `ON CONFLICT (queue, dedupe_key) DO NOTHING`. That is what makes a re-drained
 * outbox row a no-op rather than a double delivery.
 */
export async function enqueueHookJobs(jobs: HookJob[]): Promise<void> {
  if (jobs.length === 0) return
  if (!isPooledTenancy()) {
    await enqueueHookJobsWithIds(jobs as Parameters<typeof enqueueHookJobsWithIds>[0])
    return
  }
  for (const job of jobs) {
    await enqueueJob({
      queue: EVENTS_QUEUE,
      payload: { ...job.data, name: job.name } as unknown as Record<string, unknown>,
      dedupeKey: job.jobId,
      maxAttempts: HOOK_RETRY_ATTEMPTS,
    })
  }
}
