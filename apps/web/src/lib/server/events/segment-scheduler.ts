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
import { config } from '@/lib/server/config'
import type { SegmentId } from '@quackback/ids'
import type { EvaluationSchedule } from '@/lib/server/db'

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
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86400 }, // keep failed jobs 7 days
}

// ============================================================================
// Lazy initialization
// ============================================================================

let initPromise: Promise<{
  queue: Queue<SegmentEvalJobData>
  worker: Worker<SegmentEvalJobData>
}> | null = null

function ensureQueue(): Promise<Queue<SegmentEvalJobData>> {
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

  const queue = new Queue<SegmentEvalJobData>(QUEUE_NAME, {
    connection: connOpts,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<SegmentEvalJobData>(
    QUEUE_NAME,
    async (job) => {
      const { segmentId } = job.data
      console.log(`[SegmentScheduler] Evaluating segment ${segmentId}`)

      // Lazy import to avoid circular deps
      const { evaluateDynamicSegment } =
        await import('@/lib/server/domains/segments/segment.service')

      try {
        const result = await evaluateDynamicSegment(segmentId as SegmentId)
        console.log(
          `[SegmentScheduler] Segment ${segmentId}: added=${result.added}, removed=${result.removed}`
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
    { connection: connOpts, concurrency: CONCURRENCY }
  )

  // Verify Redis is reachable
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
    console.error(
      `[SegmentScheduler] Evaluation ${prefix} for segment ${job.data.segmentId}: ${error.message}`
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

  console.log(
    `[SegmentScheduler] Scheduled evaluation for segment ${segmentId} with pattern "${schedule.pattern}"`
  )
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
      console.log(`[SegmentScheduler] Removed schedule for segment ${segmentId}`)
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
      console.log(`[SegmentScheduler] Restored ${restored} evaluation schedule(s)`)
    }
  } catch (error) {
    console.error('[SegmentScheduler] Failed to restore evaluation schedules:', error)
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

  await worker.close().catch((e) => console.error('[SegmentScheduler] Worker close error:', e))
  await queue.close().catch((e) => console.error('[SegmentScheduler] Queue close error:', e))
}
