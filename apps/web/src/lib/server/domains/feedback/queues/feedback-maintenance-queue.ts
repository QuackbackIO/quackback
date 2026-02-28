/**
 * Feedback maintenance queue — stuck-item recovery and suggestion expiry.
 *
 * Low concurrency (1) for background maintenance work.
 */

import { Queue, Worker, UnrecoverableError } from 'bullmq'
import { config } from '@/lib/server/config'
import type { FeedbackMaintenanceJob } from '../types'

const QUEUE_NAME = '{feedback-maintenance}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 10000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86400 },
}

let initPromise: Promise<{
  queue: Queue<FeedbackMaintenanceJob>
  worker: Worker<FeedbackMaintenanceJob>
}> | null = null

function ensureQueue(): Promise<Queue<FeedbackMaintenanceJob>> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise.then(({ queue }) => queue)
}

async function initializeQueue() {
  const connOpts = {
    url: config.redisUrl,
    maxRetriesPerRequest: null as null,
    connectTimeout: 5_000,
  }

  const queue = new Queue<FeedbackMaintenanceJob>(QUEUE_NAME, {
    connection: connOpts,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<FeedbackMaintenanceJob>(
    QUEUE_NAME,
    async (job) => {
      const data = job.data

      switch (data.type) {
        case 'recover-stuck-items': {
          const { recoverStuckItems } = await import('../pipeline/stuck-recovery.service')
          await recoverStuckItems()
          break
        }
        case 'expire-stale-suggestions': {
          const { expireStaleSuggestions } = await import('../pipeline/suggestion.service')
          const count = await expireStaleSuggestions()
          if (count > 0) {
            console.log(`[FeedbackMaintenance] Expired ${count} stale suggestions`)
          }
          break
        }
        default:
          throw new UnrecoverableError(
            `Unknown maintenance job type: ${(data as { type: string }).type}`
          )
      }
    },
    { connection: connOpts, concurrency: CONCURRENCY }
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
    console.error(`[FeedbackMaintenance] ${job.data.type} ${prefix}: ${error.message}`)
  })

  return { queue, worker }
}

/**
 * Restore repeatable schedules on startup.
 */
export async function restoreAllFeedbackSchedules(): Promise<void> {
  const queue = await ensureQueue()

  // Stuck-item recovery every 15 minutes
  await queue.upsertJobScheduler(
    'recover-stuck-items',
    { every: 15 * 60 * 1000 },
    { name: 'maintenance:recover-stuck-items', data: { type: 'recover-stuck-items' } }
  )

  // Expire stale suggestions daily
  await queue.upsertJobScheduler(
    'expire-stale-suggestions',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'maintenance:expire-stale-suggestions', data: { type: 'expire-stale-suggestions' } }
  )

  console.log('[FeedbackMaintenance] Restored feedback schedules')
}

export async function closeFeedbackMaintenanceQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker.close().catch(() => {})
  await queue.close().catch(() => {})
}
