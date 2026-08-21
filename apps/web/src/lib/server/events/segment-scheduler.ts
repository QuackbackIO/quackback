/**
 * Segment evaluation scheduler — cron-scheduled re-evaluation of dynamic
 * segments.
 *
 * Each dynamic segment with an `evaluationSchedule` gets a slot on its own cron
 * pattern. When the slot comes due the handler re-evaluates that segment's
 * rules and syncs membership.
 *
 * ## The schedules are derived, not registered
 *
 * Under BullMQ each segment's schedule was a *repeatable job written into
 * Redis*, which meant the truth lived in two places — the `segments` row and
 * the Redis key — and had to be reconciled: `restoreAllEvaluationSchedules()`
 * ran at boot precisely because Redis could have been cleared, and every
 * create/update/delete had to remember to call the upsert or the remove.
 *
 * Here the scheduler reads the rows every tick (`segmentEvaluationSchedules()`)
 * and there is no second copy. A segment created a second ago is scheduled on
 * the next tick; a deleted or disabled one stops being scheduled with no
 * removal call at all. That deletes the restore step and the whole class of
 * drift it existed to repair, so the upsert/remove functions become
 * announcements rather than state changes — kept because their call sites are
 * the right places to log an intent, and because their absence would read as
 * "nobody scheduled this".
 */

import type { SegmentId } from '@quackback/ids'
import { db, segments, eq, and, isNull, type EvaluationSchedule } from '@/lib/server/db'
import { TerminalJobError, type DynamicSchedule } from '@/lib/server/jobs/definitions'
import { nextSlotAfter, parseCron } from '@/lib/server/jobs/cron'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { evaluateDynamicSegment } from '@/lib/server/domains/segments/segment.evaluation'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'segment-scheduler' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const SEGMENT_EVALUATION_QUEUE = 'segment-evaluation'

/**
 * Every dynamic segment's live schedule, read from this workspace's own database.
 *
 * Called on each schedule tick inside the workspace's scope, so the answer is per
 * workspace by construction. A pattern the cron parser rejects is dropped with a
 * loud log rather than defaulting to some permissive reading: a mis-parsed
 * expression changes a segment's cadence with no error anywhere.
 */
export async function segmentEvaluationSchedules(): Promise<DynamicSchedule[]> {
  const rows = await db
    .select({ id: segments.id, evaluationSchedule: segments.evaluationSchedule })
    .from(segments)
    .where(and(eq(segments.type, 'dynamic'), isNull(segments.deletedAt)))

  const out: DynamicSchedule[] = []
  for (const row of rows) {
    const schedule = row.evaluationSchedule as EvaluationSchedule | null
    if (!schedule?.enabled || !schedule.pattern) continue
    try {
      parseCron(schedule.pattern)
    } catch (err) {
      log.error(
        { err, segment_id: row.id, pattern: schedule.pattern },
        'segment evaluation schedule has an unparseable cron pattern; not scheduled'
      )
      continue
    }
    out.push({
      key: String(row.id),
      cron: schedule.pattern,
      payload: { segmentId: String(row.id) },
    })
  }
  return out
}

/** Re-evaluate one dynamic segment. */
export async function runSegmentEvaluation(job: ClaimedJob): Promise<void> {
  const segmentId = (job.payload as { segmentId?: string }).segmentId
  if (!segmentId) {
    throw new TerminalJobError('segment evaluation job carried no segment id')
  }
  log.debug({ segment_id: segmentId }, 'evaluating segment')

  try {
    const result = await evaluateDynamicSegment(segmentId as SegmentId)
    log.info(
      { segment_id: segmentId, added: result.added, removed: result.removed },
      'segment evaluated'
    )
  } catch (error) {
    // If the segment was deleted or is no longer dynamic, retrying reaches the
    // same answer three times.
    if (
      error instanceof Error &&
      (error.message.includes('not found') || error.message.includes('not dynamic'))
    ) {
      throw new TerminalJobError(error.message)
    }
    throw error
  }
}

/**
 * Record that a segment's evaluation schedule changed.
 *
 * There is nothing to write: the scheduler reads `segments.evaluationSchedule`
 * on every tick, so the row the caller just saved *is* the schedule. Kept as
 * the call site's statement of intent, and because a silent removal would leave
 * "who schedules this?" unanswerable from the create path.
 */
export async function upsertSegmentEvaluationSchedule(
  segmentId: SegmentId,
  schedule: EvaluationSchedule
): Promise<void> {
  if (!schedule.enabled) {
    log.info({ segment_id: segmentId }, 'segment evaluation schedule disabled')
    return
  }
  try {
    parseCron(schedule.pattern)
  } catch (err) {
    // Loud, because the segment will simply never evaluate and nothing else
    // would say so.
    log.error(
      { err, segment_id: segmentId, pattern: schedule.pattern },
      'segment evaluation schedule has an unparseable cron pattern and will not run'
    )
    return
  }
  log.info({ segment_id: segmentId, pattern: schedule.pattern }, 'scheduled segment evaluation')
}

/** Counterpart to the above; likewise nothing to unwrite. */
export async function removeSegmentEvaluationSchedule(segmentId: SegmentId): Promise<void> {
  log.info({ segment_id: segmentId }, 'removed segment schedule')
}

/**
 * List the live evaluation schedules, for admin diagnostics.
 *
 * `next` is computed from the pattern rather than read back from a scheduler,
 * which is the same answer with one fewer place to be stale.
 */
export async function listEvaluationSchedules(): Promise<
  Array<{ segmentId: string; pattern: string; next: number | undefined }>
> {
  const now = new Date()
  return (await segmentEvaluationSchedules()).map((s) => ({
    segmentId: s.key,
    pattern: s.cron,
    next: nextSlotAfter(parseCron(s.cron), now)?.getTime(),
  }))
}
