/**
 * Feedback AI queue — extraction and interpretation.
 *
 * Lower concurrency (1) to avoid hammering OpenAI rate limits.
 */

import { Queue, Worker, UnrecoverableError } from 'bullmq'
import { getRedisConnectionOpts, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import type { FeedbackAiJob } from '../types'
import type { RawFeedbackItemId, FeedbackSignalId } from '@quackback/ids'

const QUEUE_NAME = '{feedback-ai}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: true,
  removeOnFail: { age: 14 * 86400 },
}

let initPromise: Promise<{
  queue: Queue<FeedbackAiJob>
  worker: Worker<FeedbackAiJob>
}> | null = null

function ensureQueue(): Promise<Queue<FeedbackAiJob>> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise.then(({ queue }) => queue)
}

async function initializeQueue() {
  const connOpts = getRedisConnectionOpts()

  const queue = new Queue<FeedbackAiJob>(QUEUE_NAME, {
    connection: connOpts,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<FeedbackAiJob>(
    QUEUE_NAME,
    async (job) => {
      const data = job.data

      switch (data.type) {
        case 'extract-signals': {
          const { extractSignals } = await import('../pipeline/extraction.service')
          await extractSignals(data.rawItemId as RawFeedbackItemId)
          break
        }
        case 'interpret-signal': {
          const { interpretSignal } = await import('../pipeline/interpretation.service')
          await interpretSignal(data.signalId as FeedbackSignalId, {
            currentAttempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts ?? 1,
          })
          break
        }
        case 'retention-cleanup': {
          const { cleanupExpiredLogs } = await import('../../ai/usage-log')
          await cleanupExpiredLogs()
          break
        }
        default:
          throw new UnrecoverableError(`Unknown AI job type: ${(data as { type: string }).type}`)
      }
    },
    { connection: connOpts, concurrency: CONCURRENCY }
  )

  // Register daily retention cleanup as a repeatable job
  await queue.add(
    'ai:retention-cleanup',
    { type: 'retention-cleanup' },
    {
      repeat: { pattern: '0 3 * * *' }, // 3 AM daily
      removeOnComplete: true,
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
    console.error(`[FeedbackAI] ${job.data.type} ${prefix}: ${error.message}`)
  })

  return { queue, worker }
}

/** Initialize the AI queue worker eagerly (called from startup). */
export async function initFeedbackAiWorker(): Promise<void> {
  await ensureQueue()
  console.log('[FeedbackAI] Worker initialized')
}

/** Enqueue a feedback AI job. */
export async function enqueueFeedbackAiJob(data: FeedbackAiJob): Promise<void> {
  const queue = await ensureQueue()
  await queue.add(`ai:${data.type}`, data)
}

export async function closeFeedbackAiQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker.close().catch(() => {})
  await queue.close().catch(() => {})
}
