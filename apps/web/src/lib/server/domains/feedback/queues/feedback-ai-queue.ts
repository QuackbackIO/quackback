/**
 * Feedback AI queue — extraction and interpretation.
 *
 * Lower concurrency (1) to avoid hammering OpenAI rate limits.
 */

import { Queue, Worker, UnrecoverableError } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { logger } from '@/lib/server/logger'
import type { FeedbackAiJob } from '../types'
import type { RawFeedbackItemId, FeedbackSignalId } from '@quackback/ids'

const log = logger.child({ component: 'feedback-ai-queue' })

const QUEUE_NAME = '{feedback-ai}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  // Last 1000 completed (or 24h) — see process.ts for the rationale.
  removeOnComplete: { count: 1000, age: 86400 },
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
  const connection = getQueueRedis()

  const queue = new Queue<FeedbackAiJob>(QUEUE_NAME, {
    connection,
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
    {
      connection,
      concurrency: CONCURRENCY,
      // OpenAI calls can run for up to ~60s on a slow extraction.
      // Default lockDuration of 30s would let BullMQ mark the job as
      // stalled and re-dispatch it to another worker — causing the
      // double-billing this whole P1 batch is fixing. 120s gives 2x
      // headroom on the worst-case latency.
      lockDuration: 120_000,
    }
  )

  // Register daily retention cleanup as a repeatable job. Stable jobId
  // ensures multiple worker boots / process restarts don't accidentally
  // schedule N copies of the same cron — BullMQ dedupes on jobId.
  await queue.add(
    'ai:retention-cleanup',
    { type: 'retention-cleanup' },
    {
      jobId: 'feedback-ai:retention-cleanup',
      repeat: { pattern: '0 3 * * *' }, // 3 AM daily
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
    log.error({ err: error, job_type: job.data.type, status: prefix }, 'feedback ai job failed')
  })

  return { queue, worker }
}

/** Initialize the AI queue worker eagerly (called from startup). */
export async function initFeedbackAiWorker(): Promise<void> {
  await ensureQueue()
  log.debug('worker initialized')
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
