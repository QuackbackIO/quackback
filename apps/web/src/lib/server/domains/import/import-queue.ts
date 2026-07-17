/**
 * Import commit queue (§I1) — the async side of the CSV import pipeline.
 * Lazy-init Promise singleton matches the {feedback-ingest} pattern.
 *
 * A single attempt per job: a retry with no idempotence tracking (§I2 adds
 * source-id matching) would re-run the whole batch and double-import rows
 * that already landed before the failure. Failures are reported on the run
 * row (status='failed') instead — safer than a silent partial re-run.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'
import type { ImportCommitJobData } from './import-run-processor'

const log = logger.child({ component: 'import-queue' })

const QUEUE_NAME = '{import}'
const CONCURRENCY = 2

const DEFAULT_JOB_OPTS = {
  attempts: 1,
  removeOnComplete: { count: 200, age: 7 * 86400 },
  removeOnFail: { age: 14 * 86400 },
}

let initPromise: Promise<{
  queue: Queue<ImportCommitJobData>
  worker: Worker<ImportCommitJobData> | null
}> | null = null

function ensureQueue(): Promise<Queue<ImportCommitJobData>> {
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

  const queue = new Queue<ImportCommitJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  // Consumer side is role-gated: web-role replicas enqueue and register
  // schedules but never construct a Worker (see queue/role.ts).
  const worker = shouldRunWorkers()
    ? new Worker<ImportCommitJobData>(
        QUEUE_NAME,
        async (job) => {
          const { runImportCommitJob } = await import('./import-run-processor')
          await runImportCommitJob(job.data)
        },
        { connection, concurrency: CONCURRENCY }
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
    log.error({ err: error, run_id: job.data.runId }, 'import commit job failed permanently')
  })

  return { queue, worker }
}

/** Enqueue a commit job. Returns once BullMQ has accepted it (not once it runs). */
export async function enqueueImportCommitJob(data: ImportCommitJobData): Promise<void> {
  const queue = await ensureQueue()
  await queue.add('commit', data)
}

export async function closeImportQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
