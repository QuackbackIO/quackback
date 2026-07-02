/**
 * page_views partition maintenance — a daily repeatable job that pre-creates
 * day partitions a week ahead and drops partitions past the retention window
 * (see @quackback/db page-view-partitions). Also runs an ensure pass at boot
 * so an instance that was down long enough to exhaust its window self-heals.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { logger } from '@/lib/server/logger'
import { db, ensurePageViewPartitions, dropExpiredPageViewPartitions } from '@/lib/server/db'

const log = logger.child({ component: 'page-view-partition-queue' })

const QUEUE_NAME = '{page-view-partitions}'
const CONCURRENCY = 1
const RETENTION_DAYS = 90

interface PartitionMaintenanceJob {
  type: 'maintain-partitions'
}

let initPromise: Promise<{
  queue: Queue<PartitionMaintenanceJob>
  worker: Worker<PartitionMaintenanceJob>
}> | null = null

async function runMaintenance(): Promise<void> {
  await ensurePageViewPartitions(db)
  const dropped = await dropExpiredPageViewPartitions(db, { retentionDays: RETENTION_DAYS })
  if (dropped.length > 0) {
    log.info({ dropped }, 'dropped expired page_views partitions')
  }
}

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<PartitionMaintenanceJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100, age: 7 * 86400 },
      removeOnFail: { age: 7 * 86400 },
    },
  })

  const worker = new Worker<PartitionMaintenanceJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.type === 'maintain-partitions') {
        await runMaintenance()
      }
    },
    { connection, concurrency: CONCURRENCY }
  )

  // Daily at 02:30. Stable jobId so worker reboots dedupe instead of stacking
  // duplicate cron entries.
  await queue.add(
    'page-view-partitions:daily',
    { type: 'maintain-partitions' },
    {
      jobId: 'page-view-partitions:daily',
      repeat: { pattern: '30 2 * * *' },
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
    await worker.close().catch(() => {})
    throw error
  }

  worker.on('failed', (job, error) => {
    if (!job) return
    const isPermanent =
      job.attemptsMade >= (job.opts.attempts ?? 1) || error.name === 'UnrecoverableError'
    const prefix = isPermanent ? 'permanently failed' : `failed (attempt ${job.attemptsMade})`
    log.error({ err: error, status: prefix }, 'partition maintenance job failed')
  })

  // Boot-time ensure: heal the partition window immediately rather than
  // waiting for the next cron tick (beacons drop while a day has no partition).
  ensurePageViewPartitions(db).catch((err) =>
    log.error({ err }, 'boot-time partition ensure failed')
  )

  return { queue, worker }
}

/** Initialize the partition-maintenance worker eagerly (called from startup). */
export async function initPageViewPartitionWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  log.info('page-view partition worker initialized')
}

export async function closePageViewPartitionQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker.close().catch(() => {})
  await queue.close().catch(() => {})
}
