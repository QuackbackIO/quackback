/**
 * Durable workflow-trigger dispatch (support platform §4.6). Event processing
 * used to call dispatchWorkflowsForEvent fire-and-forget straight off the
 * event: a crash/deploy in the window between the event landing and that
 * call finishing silently dropped the trigger, and a transient DB error
 * inside it dropped every workflow for that event with no retry. This queue
 * makes the call durable instead, mirroring the event-hooks queue
 * (events/process.ts): the event is enqueued, a worker calls
 * dispatchWorkflowsForEvent, and BullMQ retries a failed attempt.
 *
 * The interrupt-then-dispatch ordering (§4.6: a reply/close ends pending
 * waits before new workflows start) happens INSIDE dispatchWorkflowsForEvent,
 * so it always holds within one job, regardless of concurrency — that part is
 * intra-job ordering, not a claim about the order two different jobs run in.
 * Cross-event ordering (e.g. a reply then a close on the SAME conversation,
 * landing as two separate jobs) is a property of the worker's concurrency:
 * see CONCURRENCY below for why it's pinned at 1 (global FIFO) rather than
 * left to run several jobs in parallel.
 *
 * The job id is keyed by the event's own id, so a double-enqueue of the same
 * event (e.g. a retried processEvent call after a partial failure) dedupes
 * at the queue instead of stacking a second job.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'
import type { EventData } from '@/lib/server/events/types'

const log = logger.child({ component: 'workflow-dispatch-queue' })

// Hashtag pins all keys to a single Dragonfly thread for Lua script compat,
// same convention as the other workflow queues.
// See: https://www.dragonflydb.io/docs/integrations/bullmq
const QUEUE_NAME = '{workflow-dispatch}'

// Global FIFO: two rapid events on the SAME conversation (a reply then a
// close) are two separate jobs, and only a concurrency of 1 keeps their
// processing in enqueue order — at CONCURRENCY > 1 the jobs can run as
// concurrent workers and their interrupt/dispatch calls (see event-trigger.ts)
// can interleave across conversations' events instead of each event fully
// finishing before the next starts. Per-conversation grouping (so unrelated
// conversations could still run in parallel) is the scaling lever if this
// single-worker queue becomes a throughput bottleneck; until then, global
// ordering is the simpler and safer default.
const CONCURRENCY = 1

interface WorkflowDispatchJob {
  event: EventData
}

// Mirrors the event-hooks queue's defaults (events/process.ts): 3 attempts,
// exponential backoff, bounded retention so a missed dispatch stays
// diagnosable in `redis-cli LRANGE` / Bull Board instead of vanishing.
const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { count: 1000, age: 86400 },
  removeOnFail: { age: 30 * 86400 },
}

let initPromise: Promise<{
  queue: Queue<WorkflowDispatchJob>
  worker: Worker<WorkflowDispatchJob> | null
}> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<WorkflowDispatchJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  // Consumer side is role-gated: web-role replicas enqueue and register
  // schedules but never construct a Worker (see queue/role.ts).
  const worker = shouldRunWorkers()
    ? new Worker<WorkflowDispatchJob>(
        QUEUE_NAME,
        async (job) => {
          // Dynamic import keeps this queue module (and its bullmq construction,
          // pinned by the worker-registry seal test) free of a static dependency
          // on the rest of the workflow engine's module graph.
          const { dispatchWorkflowsForEvent } = await import('./event-trigger')
          await dispatchWorkflowsForEvent(job.data.event)
        },
        { connection, concurrency: CONCURRENCY }
      )
    : null

  // Verify Redis is reachable before returning, same guard as the other
  // lazily-initialized queues: without it, a missing Redis hangs the first
  // request that emits a workflow-triggering event.
  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (5s)')), REDIS_READY_TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    await queue.close().catch(() => {})
    await worker?.close().catch(() => {})
    throw error
  }

  worker?.on('failed', (job, error) => {
    if (!job) return
    const isPermanent =
      job.attemptsMade >= (job.opts.attempts ?? 1) || error.name === 'UnrecoverableError'
    log.error(
      {
        err: error,
        event_id: job.data.event.id,
        event_type: job.data.event.type,
        permanent: isPermanent,
        attempt: job.attemptsMade,
      },
      'workflow dispatch job failed'
    )
  })

  return { queue, worker }
}

/**
 * Lazily initialize BullMQ queue and worker, guarding against concurrent
 * first-call races. Resets on failure so a transient error doesn't
 * permanently wedge the queue.
 */
function ensureQueue(): Promise<Queue<WorkflowDispatchJob>> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise.then(({ queue }) => queue)
}

/**
 * Enqueue an event for durable workflow-trigger dispatch. The job id is
 * keyed by the event's own id, so re-enqueuing the same event dedupes
 * instead of stacking a second job.
 */
export async function enqueueWorkflowDispatch(event: EventData): Promise<void> {
  const queue = await ensureQueue()
  await queue.add('dispatch', { event }, { jobId: `workflow-dispatch:${event.id}` })
}

/**
 * Eager init (called from startup via the worker registry, like
 * workflow-wait/workflow-sweep). Without this the queue only initialized on
 * the first enqueueWorkflowDispatch call, so the first workflow-triggering
 * event after a deploy paid the up-to-5s waitUntilReady cold-start cost
 * inline (or, if Redis was briefly unreachable at that moment, silently
 * dropped the trigger instead of failing at boot where it's noticed).
 */
export async function initWorkflowDispatchWorker(): Promise<void> {
  await ensureQueue()
  log.info('workflow-dispatch worker initialized')
}

/**
 * Gracefully shut down the queue and worker. Called from the worker
 * registry's drain and in test cleanup.
 */
export async function closeWorkflowDispatchQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
