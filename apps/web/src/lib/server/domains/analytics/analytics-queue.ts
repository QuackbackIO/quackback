/**
 * Analytics queue -- hourly refresh of materialized stats.
 */

import { Queue, Worker } from 'bullmq'
import { config } from '@/lib/server/config'
import { refreshAnalytics } from './analytics.service'

const QUEUE_NAME = '{analytics}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86400 },
}

interface AnalyticsJob {
  type: 'refresh-analytics'
}

let initPromise: Promise<{ queue: Queue<AnalyticsJob>; worker: Worker<AnalyticsJob> }> | null = null

async function initializeQueue() {
  const connOpts = {
    url: config.redisUrl,
    maxRetriesPerRequest: null as null,
    connectTimeout: 5_000,
  }

  const queue = new Queue<AnalyticsJob>(QUEUE_NAME, {
    connection: connOpts,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<AnalyticsJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.type === 'refresh-analytics') {
        await refreshAnalytics()
      }
    },
    { connection: connOpts, concurrency: CONCURRENCY }
  )

  // Register hourly refresh as a repeatable job
  await queue.add(
    'analytics:refresh',
    { type: 'refresh-analytics' },
    {
      repeat: { pattern: '0 * * * *' }, // Top of every hour
      removeOnComplete: true,
      removeOnFail: { age: 7 * 86400 },
    }
  )

  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (5s)')), 5_000)
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
    console.error(`[Analytics] ${prefix}: ${error.message}`)
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
  console.log('[Analytics] Worker initialized')
}
