/**
 * Workspace export queue — the async ZIP build. Lazy-init Promise singleton
 * matching the {import} pattern.
 *
 * A single attempt per job, same reasoning as import: a blind retry would
 * redo minutes of work and could double-upload. Failures land on the run row
 * (status='failed') instead. Concurrency 1 — exports are heavy and the
 * single-active-run unique index already guarantees one at a time.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'
import type { WorkspaceExportJobData } from './export-run-processor'

const log = logger.child({ component: 'export-queue' })

const QUEUE_NAME = '{export}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 1,
  removeOnComplete: { count: 100, age: 7 * 86400 },
  removeOnFail: { age: 14 * 86400 },
}

let initPromise: Promise<{
  queue: Queue<WorkspaceExportJobData>
  worker: Worker<WorkspaceExportJobData> | null
}> | null = null

function ensureQueue(): Promise<Queue<WorkspaceExportJobData>> {
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

  const queue = new Queue<WorkspaceExportJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  // Consumer side is role-gated: web-role replicas enqueue but never
  // construct a Worker (see queue/role.ts).
  const worker = shouldRunWorkers()
    ? new Worker<WorkspaceExportJobData>(
        QUEUE_NAME,
        async (job) => {
          const { runWorkspaceExportJob } = await import('./export-run-processor')
          await runWorkspaceExportJob(job.data)
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
    log.error({ err: error, run_id: job.data.runId }, 'workspace export job failed permanently')
  })

  return { queue, worker }
}

/** Enqueue an export job. Returns once BullMQ has accepted it (not once it runs). */
export async function enqueueWorkspaceExportJob(data: WorkspaceExportJobData): Promise<void> {
  const queue = await ensureQueue()
  await queue.add('workspace-export', data)
}

export async function closeExportQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
