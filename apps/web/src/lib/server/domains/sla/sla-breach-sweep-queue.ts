/**
 * SLA breach sweeper — a per-minute repeatable job that records breaches for
 * conversations whose stamped deadline has passed with no settling event (see
 * sweepOverdueSlaBreaches). The lazy evaluator in sla.event-hooks.ts only fires
 * on agent reply / close, so without this sweep a conversation that blows its
 * deadline in silence would never be marked breached. The ticket-anchored TTR
 * clock (ticket-sla.service.ts's sweepOverdueTicketSlaBreaches) runs in the
 * same job: its lazy evaluator only fires on ticket status changes, so a
 * ticket that blows its deadline with no status move needs the sweep just the
 * same.
 */
import { Queue, Worker } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'sla-breach-sweep-queue' })

const QUEUE_NAME = '{sla-breach-sweep}'
const CONCURRENCY = 1

interface SlaBreachSweepJob {
  type: 'record-overdue-breaches'
}

let initPromise: Promise<{
  queue: Queue<SlaBreachSweepJob>
  worker: Worker<SlaBreachSweepJob> | null
}> | null = null

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue<SlaBreachSweepJob>(QUEUE_NAME, {
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
    ? new Worker<SlaBreachSweepJob>(
        QUEUE_NAME,
        async (job) => {
          if (job.data.type === 'record-overdue-breaches') {
            const { sweepOverdueSlaBreaches } = await import('./sla.service')
            const result = await sweepOverdueSlaBreaches()
            // The ticket-anchored TTR twin — same per-minute tick, same
            // exactly-once marker discipline on its own stamp.
            const { sweepOverdueTicketSlaBreaches } = await import('./ticket-sla.sweep')
            const ticketResult = await sweepOverdueTicketSlaBreaches()
            if (result.recorded > 0 || ticketResult.recorded > 0) {
              log.debug(
                { recorded: result.recorded, ticketRecorded: ticketResult.recorded },
                'sla-breach-sweep run complete'
              )
            }
          }
        },
        { connection, concurrency: CONCURRENCY }
      )
    : null

  // Every minute. Stable jobId so worker reboots dedupe instead of stacking
  // duplicate cron entries.
  await queue.add(
    'sla-breach-sweep:minutely',
    { type: 'record-overdue-breaches' },
    {
      jobId: 'sla-breach-sweep:minutely',
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
    log.error({ err: error, status: prefix }, 'sla-breach-sweep job failed')
  })

  return { queue, worker }
}

/** Initialize the SLA breach-sweep worker eagerly (called from startup). */
export async function initSlaBreachSweepWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  log.info('sla-breach-sweep worker initialized')
}

export async function closeSlaBreachSweepQueue(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null
  await worker?.close().catch(() => {})
  await queue.close().catch(() => {})
}
