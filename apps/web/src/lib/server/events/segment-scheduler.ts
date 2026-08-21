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
 * Here the scheduler derives the schedules from the rows
 * (`segmentEvaluationSchedules()`) and there is no second copy. A deleted or
 * disabled segment stops being scheduled with no removal call at all. That
 * deletes the restore step and the whole class of drift it existed to repair.
 * The upsert/remove functions are the derivation's invalidation hooks: their
 * call sites are exactly the admin actions that change the derived list, so
 * they drop the memo below (and log the intent, because a silent removal would
 * leave "who schedules this?" unanswerable from the create path).
 */

import type { SegmentId } from '@quackback/ids'
import { db, segments, eq, and, isNull, type EvaluationSchedule } from '@/lib/server/db'
import { TerminalJobError, type DynamicSchedule } from '@/lib/server/jobs/definitions'
import { nextSlotAfter, parseCron } from '@/lib/server/jobs/cron'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { TenantKeyedCache } from '@/lib/server/tenancy/tenant-keyed'
import { evaluateDynamicSegment } from '@/lib/server/domains/segments/segment.evaluation'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'segment-scheduler' })

/** The logical queue name. Matches the definition in `jobs/definitions.ts`. */
export const SEGMENT_EVALUATION_QUEUE = 'segment-evaluation'

/**
 * Memo of the derived schedule list, one entry per tenant.
 *
 * The schedule tick asks every minute per tenant for a list that only changes
 * on admin action, so the derivation's table read is memoised. Keyed by the
 * active tenant (`TenantKeyedCache` namespaces by the current tenant scope; a
 * single-tenant install lands on its one fixed namespace) and dropped by the
 * upsert/remove hooks, so an admin change on this process lands on the next
 * tick. The TTL covers writes whose hook ran elsewhere — another replica, or a
 * web process while the tier runs in a worker.
 */
const SCHEDULE_MEMO_TTL_MS = 5 * 60_000
const SCHEDULE_MEMO_KEY = 'schedules'
const scheduleMemo = new TenantKeyedCache<{ schedules: DynamicSchedule[]; expiresAt: number }>()

function invalidateScheduleMemo(): void {
  scheduleMemo.delete(SCHEDULE_MEMO_KEY)
}

/** Test seam: forget every tenant's memoised schedule list. */
export function __clearSegmentScheduleMemoForTests(): void {
  scheduleMemo.clear()
}

/**
 * Every dynamic segment's live schedule, read from this tenant's own database.
 *
 * Called on each schedule tick inside the tenant's scope, so the answer is per
 * tenant by construction (and memoised per tenant — see the memo above). A
 * pattern the cron parser rejects is dropped with a loud log rather than
 * defaulting to some permissive reading: a mis-parsed expression changes a
 * segment's cadence with no error anywhere.
 */
export async function segmentEvaluationSchedules(): Promise<DynamicSchedule[]> {
  const hit = scheduleMemo.get(SCHEDULE_MEMO_KEY)
  if (hit && hit.expiresAt > Date.now()) return hit.schedules

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
  scheduleMemo.set(SCHEDULE_MEMO_KEY, {
    schedules: out,
    expiresAt: Date.now() + SCHEDULE_MEMO_TTL_MS,
  })
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
 * There is nothing to write — the row the caller just saved *is* the schedule —
 * but there is something to forget: the memoised derivation of it. Invalidated
 * on every path through here, including a disable, because any of them changes
 * the derived list.
 */
export async function upsertSegmentEvaluationSchedule(
  segmentId: SegmentId,
  schedule: EvaluationSchedule
): Promise<void> {
  invalidateScheduleMemo()
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

/** Counterpart to the above; likewise nothing to unwrite, one memo to drop. */
export async function removeSegmentEvaluationSchedule(segmentId: SegmentId): Promise<void> {
  invalidateScheduleMemo()
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
