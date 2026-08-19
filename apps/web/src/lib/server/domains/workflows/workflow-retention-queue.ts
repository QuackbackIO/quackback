/**
 * Workflow run retention queue — a daily repeatable job that compacts old
 * terminal workflow runs' `graph` snapshots (see workflow-retention.ts).
 * Mirrors workflow-sweep-queue.ts / anon-sweep-queue.ts exactly: role-gated
 * worker (only a QUACKBACK_ROLE=worker replica actually consumes), stable
 * repeat jobId so a reboot dedupes instead of stacking duplicate cron
 * entries, and no separate cross-instance lock beyond BullMQ's own
 * single-consumption of one repeatable job — neither sibling sweep queue
 * layers sweep-lock.ts on top of its repeatable job either (that util backs
 * a different kind of maintenance task; see its own module doc), so this
 * doesn't either.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'
import { compactTerminalWorkflowRuns } from './workflow-retention'

const log = logger.child({ component: 'workflow-retention-queue' })

const QUEUE_NAME = '{workflow-retention}'
const CONCURRENCY = 1

interface WorkflowRetentionJob {
  type: 'compact-workflow-runs'
}

let initPromise: Promise<{
  queue: Queue<WorkflowRetentionJob>
  worker: Worker<WorkflowRetentionJob> | null
}> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<WorkflowRetentionJob>(QUEUE_NAME, {
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
    ? new Worker<WorkflowRetentionJob>(
        QUEUE_NAME,
        async (job) => {
          if (job.data.type === 'compact-workflow-runs') {
            const result = await compactTerminalWorkflowRuns()
            if (result.compacted > 0) {
              log.debug({ compacted: result.compacted }, 'workflow-retention run complete')
            }
          }
        },
        { connection, concurrency: CONCURRENCY }
      )
    : null

  // Daily at 04:00. Stable jobId so worker reboots dedupe instead of stacking
  // duplicate cron entries.
  await queue.add(
    'workflow-retention:daily',
    { type: 'compact-workflow-runs' },
    {
      jobId: 'workflow-retention:daily',
      repeat: { pattern: '0 4 * * *' },
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
    log.error({ err: error, status: prefix }, 'workflow-retention job failed')
  })

  return { queue, worker }
}

/** Initialize the workflow-retention worker eagerly (called from startup). */
export async function initWorkflowRetentionWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  log.info('workflow-retention worker initialized')
}

export async function closeWorkflowRetentionQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
