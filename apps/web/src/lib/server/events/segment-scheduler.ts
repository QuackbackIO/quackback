/**
 * Segment evaluation scheduler — repeatable BullMQ jobs for auto-evaluating
 * dynamic segments on a cron schedule.
 *
 * Each dynamic segment with an evaluationSchedule gets a repeatable job
 * keyed by segment ID. When fired, the worker re-evaluates the segment's
 * rules and syncs membership.
 *
 * Uses a dedicated queue (separate from event-hooks) so segment evaluation
 * doesn't compete with webhook delivery for worker slots.
 */

import { Queue, Worker, UnrecoverableError } from 'bullmq'
import { getQueueRedis, REDIS_READY_TIMEOUT_MS } from '@/lib/server/queue/redis-config'
import type { SegmentId } from '@quackback/ids'
import type { EvaluationSchedule } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'segment-scheduler' })

// ============================================================================
// Types
// ============================================================================

interface SegmentEvalJobData {
  segmentId: string
}

// ============================================================================
// Constants
// ============================================================================

// Hashtag pins all keys to a single Dragonfly thread for Lua script compat.
const QUEUE_NAME = '{segment-evaluation}'

// Segment evaluation is DB-heavy but not network-heavy. Keep concurrency low
// to avoid overwhelming the database during bulk re-evaluations.
const CONCURRENCY = 2

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  // Last 1000 completed (or 24h) — see events/process.ts for rationale.
  removeOnComplete: { count: 1000, age: 86400 },
  removeOnFail: { age: 7 * 86400 }, // keep failed jobs 7 days
}

// ============================================================================
// Lazy initialization
// ============================================================================

let initPromise: Promise<{
  queue: Queue
  worker: Worker
}> | null = null

function ensureQueue(): Promise<Queue> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  const promise = initPromise
  if (!promise) throw new Error('Segment scheduler queue failed to initialize')
  return promise.then(({ queue }) => queue)
}

async function initializeQueue() {
  const connection = getQueueRedis()

  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { segmentId } = job.data as SegmentEvalJobData
      log.debug({ segment_id: segmentId }, 'evaluating segment')

      // Lazy import to avoid circular deps
      const { evaluateDynamicSegment } =
        await import('@/lib/server/domains/segments/segment.evaluation')

      try {
        const result = await evaluateDynamicSegment(segmentId as SegmentId)
        log.info(
          { segment_id: segmentId, added: result.added, removed: result.removed },
          'segment evaluated'
        )
      } catch (error) {
        // If segment was deleted or isn't dynamic anymore, don't retry
        if (
          error instanceof Error &&
          (error.message.includes('not found') || error.message.includes('not dynamic'))
        ) {
          throw new UnrecoverableError(error.message)
        }
        throw error
      }
    },
    { connection, concurrency: CONCURRENCY }
  )

  // Verify Redis is reachable
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
    log.error(
      {
        err: error,
        segment_id: job.data.segmentId,
        permanent: isPermanent,
        attempt: job.attemptsMade,
      },
      'segment evaluation failed'
    )
  })

  return { queue, worker }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create or update a repeatable evaluation job for a dynamic segment.
 * If a job already exists for this segment, it is replaced with the new schedule.
 */
export async function upsertSegmentEvaluationSchedule(
  segmentId: SegmentId,
  schedule: EvaluationSchedule
): Promise<void> {
  const queue = await ensureQueue()
  const jobKey = `segment-eval:${segmentId}`

  await removeSegmentEvaluationSchedule(segmentId)

  if (!schedule.enabled) return

  await queue.add(
    jobKey,
    { segmentId },
    {
      repeat: {
        pattern: schedule.pattern,
      },
      jobId: jobKey,
    }
  )

  log.info({ segment_id: segmentId, pattern: schedule.pattern }, 'scheduled segment evaluation')
}

/**
 * Remove the repeatable evaluation job for a segment.
 * No-op if no schedule exists.
 */
export async function removeSegmentEvaluationSchedule(segmentId: SegmentId): Promise<void> {
  const queue = await ensureQueue()
  const jobKey = `segment-eval:${segmentId}`
  const repeatableJobs = await queue.getRepeatableJobs()
  for (const job of repeatableJobs) {
    if (job.name === jobKey) {
      await queue.removeRepeatableByKey(job.key)
      log.info({ segment_id: segmentId }, 'removed segment schedule')
      break
    }
  }
}

/**
 * Restore evaluation schedules for all dynamic segments that have them.
 * Call this on server startup to re-register repeatable jobs that may have
 * been lost if Redis was cleared.
 */
export async function restoreAllEvaluationSchedules(): Promise<void> {
  try {
    const { db, segments, eq, and, isNull } = await import('@/lib/server/db')

    const dynamicSegments = await db
      .select({
        id: segments.id,
        evaluationSchedule: segments.evaluationSchedule,
      })
      .from(segments)
      .where(and(eq(segments.type, 'dynamic'), isNull(segments.deletedAt)))

    let restored = 0
    for (const seg of dynamicSegments) {
      const schedule = seg.evaluationSchedule as EvaluationSchedule | null
      if (schedule?.enabled) {
        await upsertSegmentEvaluationSchedule(seg.id as SegmentId, schedule)
        restored++
      }
    }

    if (restored > 0) {
      log.info({ restored }, 'restored segment schedules')
    }
  } catch (error) {
    log.error({ err: error }, 'failed to restore segment schedules')
  }
}

/**
 * List all active repeatable evaluation jobs.
 * Useful for admin diagnostics.
 */
export async function listEvaluationSchedules(): Promise<
  Array<{ segmentId: string; pattern: string; next: number | undefined }>
> {
  const queue = await ensureQueue()
  const jobs = await queue.getRepeatableJobs()
  return jobs
    .filter((j) => j.name.startsWith('segment-eval:'))
    .map((j) => ({
      segmentId: j.name.replace('segment-eval:', ''),
      pattern: j.pattern ?? '',
      next: j.next,
    }))
}

/**
 * Gracefully shut down the segment evaluation queue.
 */
export async function closeSegmentScheduler(): Promise<void> {
  if (!initPromise) return
  const { worker, queue } = await initPromise
  initPromise = null

  await worker.close().catch((e) => log.error({ err: e }, 'worker close error'))
  await queue.close().catch((e) => log.error({ err: e }, 'queue close error'))
}
