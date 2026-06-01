/**
 * Anonymous-principal sweep queue — a daily repeatable job that reclaims
 * abandoned empty anon principals (see anon-sweep.service).
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { sweepAnonymousPrincipals } from './anon-sweep.service'

const QUEUE_NAME = '{anon-sweep}'
const CONCURRENCY = 1

interface AnonSweepJob {
  type: 'sweep-anonymous'
}

let initPromise: Promise<{ queue: Queue<AnonSweepJob>; worker: Worker<AnonSweepJob> }> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<AnonSweepJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100, age: 7 * 86400 },
      removeOnFail: { age: 7 * 86400 },
    },
  })

  const worker = new Worker<AnonSweepJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.type === 'sweep-anonymous') {
        const result = await sweepAnonymousPrincipals()
        if (result.deleted > 0 || result.candidates > 0) {
          console.log(`[anon-sweep] candidates=${result.candidates} deleted=${result.deleted}`)
        }
      }
    },
    { connection, concurrency: CONCURRENCY }
  )

  // Daily at 03:00. Stable jobId so worker reboots dedupe instead of stacking
  // duplicate cron entries.
  await queue.add(
    'anon-sweep:daily',
    { type: 'sweep-anonymous' },
    {
      jobId: 'anon-sweep:daily',
      repeat: { pattern: '0 3 * * *' },
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
    console.error(`[anon-sweep] ${prefix}: ${error.message}`)
  })

  return { queue, worker }
}

/** Initialize the anonymous-sweep worker eagerly (called from startup). */
export async function initAnonSweepWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  console.log('[anon-sweep] Worker initialized')
}
