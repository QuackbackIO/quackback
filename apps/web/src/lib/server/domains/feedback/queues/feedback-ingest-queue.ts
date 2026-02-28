/**
 * Feedback ingestion queue — context enrichment, poll sync, batch parsing.
 *
 * Queue name uses hashtag prefix for Dragonfly Lua script compat.
 * Lazy-init Promise singleton matches the {event-hooks} pattern in events/process.ts.
 */

import { Queue, Worker, UnrecoverableError } from 'bullmq'
import { config } from '@/lib/server/config'
import type { FeedbackIngestJob } from '../types'

const QUEUE_NAME = '{feedback-ingest}'
const CONCURRENCY = 3

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: true,
  removeOnFail: { age: 14 * 86400 },
}

let initPromise: Promise<{
  queue: Queue<FeedbackIngestJob>
  worker: Worker<FeedbackIngestJob>
}> | null = null

function ensureQueue(): Promise<Queue<FeedbackIngestJob>> {
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

  const queue = new Queue<FeedbackIngestJob>(QUEUE_NAME, {
    connection: connOpts,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<FeedbackIngestJob>(
    QUEUE_NAME,
    async (job) => {
      const data = job.data

      switch (data.type) {
        case 'enrich-context': {
          const { enrichAndAdvance } = await import('../ingestion/feedback-ingest.service')
          await enrichAndAdvance(data.rawItemId)
          break
        }
        case 'poll-source': {
          // Poll connector — will be wired in Phase 2+ (Slack/Zendesk)
          console.log(`[FeedbackIngest] poll-source not yet implemented: ${data.sourceId}`)
          break
        }
        case 'parse-batch': {
          // Batch parsing — will be wired when CSV/import connector ships
          console.log(`[FeedbackIngest] parse-batch not yet implemented: ${data.sourceId}`)
          break
        }
        default:
          throw new UnrecoverableError(
            `Unknown ingest job type: ${(data as { type: string }).type}`
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
    console.error(`[FeedbackIngest] ${job.data.type} ${prefix}: ${error.message}`)
  })

  return { queue, worker }
}

/** Enqueue a feedback ingestion job. */
export async function enqueueFeedbackIngestJob(data: FeedbackIngestJob): Promise<void> {
  const queue = await ensureQueue()
  await queue.add(`ingest:${data.type}`, data)
}

export async function closeFeedbackIngestQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker.close().catch(() => {})
  await queue.close().catch(() => {})
}
