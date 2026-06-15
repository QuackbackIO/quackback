/**
 * Analytics queue -- hourly refresh of materialized stats.
 */

import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { logger } from '@/lib/server/logger'
import { refreshAnalytics } from './analytics.service'

const log = logger.child({ component: 'analytics-queue' })

const QUEUE_NAME = '{analytics}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  // Last 1000 completed (or 24h) — see process.ts for the rationale.
  removeOnComplete: { count: 1000, age: 86400 },
  removeOnFail: { age: 7 * 86400 },
}

interface AnalyticsJob {
  type: 'refresh-analytics'
}

let initPromise: Promise<{ queue: Queue<AnalyticsJob>; worker: Worker<AnalyticsJob> }> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<AnalyticsJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<AnalyticsJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.type === 'refresh-analytics') {
        await refreshAnalytics()
      }
    },
    { connection, concurrency: CONCURRENCY }
  )

  // Register hourly refresh as a repeatable job. Stable jobId so
  // worker reboots dedupe on the same key instead of scheduling
  // duplicate cron entries.
  await queue.add(
    'analytics:refresh',
    { type: 'refresh-analytics' },
    {
      jobId: 'analytics:hourly-refresh',
      repeat: { pattern: '0 * * * *' }, // Top of every hour
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
    log.error({ err: error, status: prefix }, 'analytics job failed')
  })

  return { queue, worker }
}

/** Initialize the analytics queue worker eagerly (called from startup). */
export async function initAnalyticsWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  log.info('analytics worker initialized')
}
