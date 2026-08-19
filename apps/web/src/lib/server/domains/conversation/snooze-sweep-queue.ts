/**
 * Snooze-wake sweeper — a per-minute repeatable job that reopens snoozed
 * conversations whose wake timer has elapsed (see sweepDueSnoozedConversations),
 * publishing the same realtime/inbox updates a manual reopen does.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'snooze-sweep-queue' })

const QUEUE_NAME = '{snooze-sweep}'
const CONCURRENCY = 1

interface SnoozeSweepJob {
  type: 'wake-due-snoozed'
}

let initPromise: Promise<{
  queue: Queue<SnoozeSweepJob>
  worker: Worker<SnoozeSweepJob> | null
}> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<SnoozeSweepJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100, age: 7 * 86400 },
      removeOnFail: { age: 7 * 86400 },
    },
  })

  // Consumer side is role-gated: web-role replicas enqueue and register
  // schedules but never construct a Worker (see queue/role.ts).
  const worker = shouldRunWorkers()
    ? new Worker<SnoozeSweepJob>(
        QUEUE_NAME,
        async (job) => {
          if (job.data.type === 'wake-due-snoozed') {
            const { sweepDueSnoozedConversations } = await import('./conversation.service')
            const result = await sweepDueSnoozedConversations()
            if (result.woken > 0) {
              log.debug({ woken: result.woken }, 'snooze-sweep run complete')
            }
            // Ride the same per-minute tick to close out assistant involvements that
            // have gone quiet (assumed resolution). Best-effort: an assistant sweep
            // failure must not fail the snooze wake.
            try {
              const { finalizeStaleAssistantInvolvements } =
                await import('@/lib/server/domains/assistant')
              const { resolved } = await finalizeStaleAssistantInvolvements()
              if (resolved > 0) {
                log.debug({ resolved }, 'assistant assumed-resolution sweep complete')
              }
            } catch (err) {
              log.warn({ err }, 'assistant assumed-resolution sweep failed')
            }
            // Also expire pending actions nobody approved in time, and let the
            // customer know the request timed out rather than leaving them
            // hanging. Best-effort, same as the involvement sweep above.
            try {
              const { sweepAndNotifyExpiredPendingActions } =
                await import('@/lib/server/domains/assistant/pending-actions.service')
              const expired = await sweepAndNotifyExpiredPendingActions()
              if (expired.length > 0) {
                log.debug(
                  { expired: expired.length },
                  'assistant pending-action expiry sweep complete'
                )
              }
            } catch (err) {
              log.warn({ err }, 'assistant pending-action expiry sweep failed')
            }
          }
        },
        { connection, concurrency: CONCURRENCY }
      )
    : null

  // Every minute. Stable jobId so worker reboots dedupe instead of stacking
  // duplicate cron entries.
  await queue.add(
    'snooze-sweep:minutely',
    { type: 'wake-due-snoozed' },
    {
      jobId: 'snooze-sweep:minutely',
      repeat: { pattern: '* * * * *' },
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
    await worker?.close().catch(() => {})
    throw error
  }

  worker?.on('failed', (job, error) => {
    if (!job) return
    const isPermanent =
      job.attemptsMade >= (job.opts.attempts ?? 1) || error.name === 'UnrecoverableError'
    const prefix = isPermanent ? 'permanently failed' : `failed (attempt ${job.attemptsMade})`
    log.error({ err: error, status: prefix }, 'snooze-sweep job failed')
  })

  return { queue, worker }
}

/** Initialize the snooze-sweep worker eagerly (called from startup). */
export async function initSnoozeSweepWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  log.info('snooze-sweep worker initialized')
}

export async function closeSnoozeSweepQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
