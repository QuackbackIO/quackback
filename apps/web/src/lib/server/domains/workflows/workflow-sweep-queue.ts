/**
 * Workflow run sweeper — a five-minute repeatable job that reconciles runs
 * stranded outside a durable wait boundary (see sweepWorkflowRuns): a
 * crashed process's stale 'running' rows, and 'waiting' rows whose durable
 * timer went missing.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'workflow-sweep-queue' })

const QUEUE_NAME = '{workflow-sweep}'
const CONCURRENCY = 1

interface WorkflowSweepJob {
  type: 'sweep-workflow-runs'
}

let initPromise: Promise<{
  queue: Queue<WorkflowSweepJob>
  worker: Worker<WorkflowSweepJob> | null
}> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<WorkflowSweepJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100, age: 7 * 86400 },
      removeOnFail: { age: 7 * 86400 },
    },
  })

  // Consumer side is role-gated: web-role replicas enqueue and register
  // schedules but never construct a Worker (see queue/role.ts).
  const worker = shouldRunWorkers()
    ? new Worker<WorkflowSweepJob>(
        QUEUE_NAME,
        async (job) => {
          if (job.data.type === 'sweep-workflow-runs') {
            const { sweepWorkflowRuns } = await import('./workflow-sweep')
            await sweepWorkflowRuns()
          }
        },
        { connection, concurrency: CONCURRENCY }
      )
    : null

  // Every 5 minutes. Stable jobId so worker reboots dedupe instead of
  // stacking duplicate cron entries.
  await queue.add(
    'workflow-sweep:five-minutely',
    { type: 'sweep-workflow-runs' },
    {
      jobId: 'workflow-sweep:five-minutely',
      repeat: { pattern: '*/5 * * * *' },
      removeOnComplete: { count: 100 },
      removeOnFail: { age: 7 * 86400 },
    }
  )

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
    const prefix = isPermanent ? 'permanently failed' : `failed (attempt ${job.attemptsMade})`
    log.error({ err: error, status: prefix }, 'workflow-sweep job failed')
  })

  return { queue, worker }
}

/** Initialize the workflow-sweep worker eagerly (called from startup). */
export async function initWorkflowSweepWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  log.info('workflow-sweep worker initialized')
}

export async function closeWorkflowSweepQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
