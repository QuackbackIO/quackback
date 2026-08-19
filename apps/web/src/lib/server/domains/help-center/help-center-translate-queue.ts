/**
 * Help-center auto-translate queue (domains/languages §H3).
 *
 * A small, dedicated queue rather than reusing feedback's feedback-ai queue:
 * that queue's worker would need to import back into help-center to process
 * the job, and help-center already needs to import the enqueue function --
 * a two-way domain dependency the project's dep-graph check treats as a new
 * cycle requiring an explicit decision. A same-shaped, single-purpose queue
 * (same low concurrency + long lock duration rationale as feedback-ai) costs
 * one small file and keeps the domain graph acyclic.
 */
import { Queue, Worker, UnrecoverableError } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'
import type { KbArticleId } from '@quackback/ids'

const log = logger.child({ component: 'help-center-translate-queue' })

export interface HelpCenterTranslateJob {
  type: 'translate-article'
  articleId: string
  locale: string
}

const QUEUE_NAME = '{help-center-translate}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 1000, age: 86400 },
  removeOnFail: { age: 14 * 86400 },
}

let initPromise: Promise<{
  queue: Queue<HelpCenterTranslateJob>
  worker: Worker<HelpCenterTranslateJob> | null
}> | null = null

function ensureQueue(): Promise<Queue<HelpCenterTranslateJob>> {
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

  const queue = new Queue<HelpCenterTranslateJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  // Consumer side is role-gated: web-role replicas enqueue and register
  // schedules but never construct a Worker (see queue/role.ts).
  const worker = shouldRunWorkers()
    ? new Worker<HelpCenterTranslateJob>(
        QUEUE_NAME,
        async (job) => {
          const data = job.data
          switch (data.type) {
            case 'translate-article': {
              const { translateArticleForLocale } =
                await import('./help-center-auto-translate.service')
              await translateArticleForLocale(data.articleId as KbArticleId, data.locale)
              break
            }
            default:
              throw new UnrecoverableError(
                `Unknown help-center-translate job type: ${(data as { type: string }).type}`
              )
          }
        },
        {
          connection,
          concurrency: CONCURRENCY,
          // Same rationale as feedback-ai: an OpenAI call can run long enough
          // that the default 30s lockDuration would let BullMQ mark it stalled
          // and re-dispatch (double-billing) before it finishes.
          lockDuration: 120_000,
        }
      )
    : null

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
    log.error({ err: error, status: prefix }, 'help-center translate job failed')
  })

  return { queue, worker }
}

/** Initialize the queue worker eagerly (called from startup). */
export async function initHelpCenterTranslateWorker(): Promise<void> {
  await ensureQueue()
  log.debug('worker initialized')
}

export async function enqueueHelpCenterTranslateJob(data: HelpCenterTranslateJob): Promise<void> {
  const queue = await ensureQueue()
  await queue.add(`translate:${data.articleId}:${data.locale}`, data)
}

export async function closeHelpCenterTranslateQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
