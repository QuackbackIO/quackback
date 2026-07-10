/**
 * Apply-SLA (support platform §4.6): stamp a policy's clocks onto a conversation
 * and open its timeline. An SLA is applied ONLY here — the Apply-SLA workflow
 * action calls this; it is never matched ambiently. The computed deadlines are
 * office-hours aware and SNAPSHOT the policy's targets, so a later edit to the
 * policy never moves a clock that is already running on a live conversation.
 * Breach evaluation reads `sla_applied` and appends to the append-only
 * `sla_events` log, from two directions that share one recording path:
 * lazily on agent reply / close (sla.event-hooks.ts), and via the per-minute
 * sweep (sla-breach-sweep-queue.ts) for deadlines that pass with no event.
 */
import {
  db,
  and,
  eq,
  isNotNull,
  sql,
  conversations,
  slaEvents,
  type Conversation,
  type SlaPolicy,
} from '@/lib/server/db'
import type { ConversationId, SlaPolicyId } from '@quackback/ids'
import { getSlaPolicy } from './sla-policy.service'
import {
  addOfficeHoursSeconds,
  engineScheduleFromWorkspace,
  getScheduleById,
} from '../office-hours/office-hours.service'
import { getOfficeHoursSchedule } from '../settings/settings.office-hours'

/**
 * The `conversations.sla_applied` shape: the one active SLA on a conversation.
 * A `type` (not `interface`) so it stays assignable to the column's
 * `Record<string, unknown>` json type.
 */
export type SlaApplied = {
  policyId: SlaPolicyId
  // Snapshot for display without a join back to the (possibly edited/deleted) policy.
  policyName: string
  appliedAt: string // ISO
  // Absolute, office-hours-aware deadlines; null = that clock is untracked by the
  // policy. The next-response clock restarts on every customer message, so only
  // its target (seconds) is snapshotted — the evaluator computes its due time.
  firstResponseDueAt: string | null
  nextResponseTargetSecs: number | null
  timeToCloseDueAt: string | null
  // Lazy-eval outcomes: when the first teammate reply / the resolution landed
  // (set by the breach evaluator), or null while that clock is still open.
  firstResponseAt?: string | null
  resolvedAt?: string | null
  // Breach-noted markers: set the moment a breach event is logged (by the
  // sweep or the lazy evaluator), so repeated sweeps and a late settle stay
  // exactly-once on the sla_events log. Unset on old stamps = not yet noted.
  firstResponseBreachedAt?: string | null
  resolutionBreachedAt?: string | null
  // Snapshot of the policy's pause rule so the inbox chip can show a paused
  // state without a join back to the policy. Stamps written before this field
  // existed read as true (the policy default).
  pauseOnSnooze?: boolean
  // ISO instant the clock was paused at (the conversation entered 'snoozed'
  // under a pauseOnSnooze policy). Absent/null while the clock is running.
  // Set by pauseSlaOnSnooze, cleared by resumeSlaFromSnooze once the
  // still-unsettled deadlines have been shifted forward by the paused span.
  pausedAt?: string | null
}

/**
 * The schedule a policy's clocks run on: its pinned table schedule if one is
 * set and still exists, else the workspace office-hours schedule from the
 * settings blob (the canonical hours source — the same one Messenger reply
 * expectations and the workflows office-hours condition read). A disabled or
 * unconfigured workspace schedule resolves 24/7, so it never blocks a clock.
 */
async function resolveScheduleFor(
  policy: SlaPolicy
): Promise<{ timezone: string; intervals: { day: number; start: string; end: string }[] }> {
  if (policy.officeHoursScheduleId) {
    const pinned = await getScheduleById(policy.officeHoursScheduleId)
    if (pinned) return pinned
  }
  return engineScheduleFromWorkspace(await getOfficeHoursSchedule())
}

/**
 * Apply a policy to a conversation: compute the deadlines, stamp `sla_applied`,
 * and log an 'applied' event. Re-applying replaces the active SLA (one per
 * conversation). `at` is injectable so callers/tests pin the clock origin.
 */
export async function applySlaToConversation(
  conversationId: ConversationId,
  policyId: SlaPolicyId,
  at: Date = new Date()
): Promise<SlaApplied> {
  const policy = await getSlaPolicy(policyId)
  if (!policy) throw new Error(`SLA policy ${policyId} not found`)
  const schedule = await resolveScheduleFor(policy)

  const applied: SlaApplied = {
    policyId: policy.id,
    policyName: policy.name,
    appliedAt: at.toISOString(),
    firstResponseDueAt: policy.firstResponseTargetSecs
      ? addOfficeHoursSeconds(schedule, at, policy.firstResponseTargetSecs).toISOString()
      : null,
    nextResponseTargetSecs: policy.nextResponseTargetSecs ?? null,
    timeToCloseDueAt: policy.timeToCloseTargetSecs
      ? addOfficeHoursSeconds(schedule, at, policy.timeToCloseTargetSecs).toISOString()
      : null,
    firstResponseAt: null,
    pauseOnSnooze: policy.pauseOnSnooze,
  }

  await db
    .update(conversations)
    .set({ slaApplied: applied, updatedAt: at })
    .where(eq(conversations.id, conversationId))

  await db.insert(slaEvents).values({
    conversationId,
    policyId: policy.id,
    kind: 'applied',
    meta: {
      firstResponseDueAt: applied.firstResponseDueAt,
      timeToCloseDueAt: applied.timeToCloseDueAt,
    },
  })

  return applied
}

/** The active SLA stamped on a conversation, or null when none is applied. */
async function loadSlaApplied(conversationId: ConversationId): Promise<SlaApplied | null> {
  const [row] = await db
    .select({ slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return (row?.slaApplied as SlaApplied | undefined) ?? null
}

/**
 * The CAS guard shared by every writer of `conversations.sla_applied`
 * (pause/resume/settle): the update only lands while the stamp is still the
 * exact one the caller read from — `appliedAt` identifies which SLA
 * application it is, `pausedAt` identifies which pause state (or its absence,
 * `null`) the caller computed its write from. A miss means a concurrent
 * apply/pause/resume/settle already moved the stamp, and that write must win
 * over this one rather than get overwritten. One helper so the three call
 * sites can't drift on the predicate shape.
 */
function slaStampGuard(conversationId: ConversationId, appliedAt: string, pausedAt: string | null) {
  return and(
    eq(conversations.id, conversationId),
    sql`${conversations.slaApplied} ->> 'appliedAt' = ${appliedAt}`,
    pausedAt === null
      ? sql`${conversations.slaApplied} ->> 'pausedAt' IS NULL`
      : sql`${conversations.slaApplied} ->> 'pausedAt' = ${pausedAt}`
  )
}

/** Append one clock event to the log — the single meta shape both the lazy
 *  evaluator and the sweep record with. */
async function insertClockEvent(
  conversationId: ConversationId,
  policyId: SlaPolicyId,
  kind: string,
  dueAt: string,
  at: Date
): Promise<void> {
  const overdueMs = at.getTime() - new Date(dueAt).getTime()
  await db.insert(slaEvents).values({
    conversationId,
    policyId,
    kind,
    meta: { dueAt, at: at.toISOString(), overdueSecs: Math.max(0, Math.round(overdueMs / 1000)) },
  })
}

/**
 * Persist a mutated stamp with NO clock event — for settling a clock whose
 * breach the sweep already logged (the event must stay exactly-once). Guarded
 * by slaStampGuard on the `(appliedAt, pausedAt)` the caller computed `next`
 * from — the same CAS pause/resume already use — so a concurrent
 * pause/resume/settle that moved the stamp first wins instead of getting
 * clobbered by this write. Returns whether the write landed; a caller whose
 * guard misses must reload the stamp and recompute before retrying (see
 * recordFirstResponse/recordResolution), the same trade-off pauseSlaOnSnooze's
 * guard documents.
 */
async function commitStamp(
  conversationId: ConversationId,
  next: SlaApplied,
  at: Date,
  guard: { appliedAt: string; pausedAt: string | null }
): Promise<boolean> {
  const [row] = await db
    .update(conversations)
    .set({ slaApplied: next, updatedAt: at })
    .where(slaStampGuard(conversationId, guard.appliedAt, guard.pausedAt))
    .returning({ id: conversations.id })
  return Boolean(row)
}

/** Persist a mutated stamp + append one clock event in a single spot (both
 *  writes always travel together, so callers never leave the stamp and log out
 *  of sync). Same guarded write as commitStamp — the event is logged only when
 *  the stamp write landed. */
async function commitClockEvent(
  conversationId: ConversationId,
  next: SlaApplied,
  kind: string,
  dueAt: string,
  at: Date,
  guard: { appliedAt: string; pausedAt: string | null }
): Promise<boolean> {
  if (!(await commitStamp(conversationId, next, at, guard))) return false
  await insertClockEvent(conversationId, next.policyId, kind, dueAt, at)
  return true
}

/**
 * The deadline to judge a settle against: the stamped due date, shifted by any
 * pause still active at `at`. Settling mid-snooze (e.g. a teammate replies to a
 * still-snoozed conversation) doesn't itself resume the clock, since resume
 * only happens when the conversation leaves 'snoozed', so this treats the
 * elapsed pause up to the settle moment as excluded time, the same as an
 * instantaneous resume-then-settle would. Once the conversation does resume,
 * this reduces to the stamped due date (pausedAt is cleared by then).
 */
function dueAtForSettle(dueAt: string, pausedAt: string | null | undefined, at: Date): Date {
  const due = new Date(dueAt)
  if (!pausedAt) return due
  const elapsedPauseMs = Math.max(0, at.getTime() - new Date(pausedAt).getTime())
  return new Date(due.getTime() + elapsedPauseMs)
}

/**
 * Record the first teammate reply against the first-response clock and log
 * met/breached. Idempotent (only the first reply counts) and a no-op when no SLA
 * is applied or the policy doesn't track first response. If the clock is
 * currently paused (snoozed under pauseOnSnooze), the elapsed pause up to `at`
 * is excluded, see dueAtForSettle. When the sweep already noted the breach
 * (firstResponseBreachedAt is set), the reply only settles the clock — no
 * second event.
 *
 * Guarded the same way as pause/resume (slaStampGuard): a concurrent
 * pause/resume landing between this function's read and its write (e.g. a
 * snooze resumes mid-settle, shifting the deadline and clearing pausedAt)
 * loses the CAS. On that miss the stamp is reloaded and the settle recomputed
 * exactly once against the fresh state — so it retries against the shifted
 * deadline instead of writing a stale, un-shifted one that resurrects a
 * pausedAt the resume already cleared. If the retry also misses (or the
 * reload shows the clock already settled), this leaves it rather than
 * clobber a newer write, the same trade-off pauseSlaOnSnooze documents.
 */
export async function recordFirstResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  let applied = await loadSlaApplied(conversationId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.firstResponseDueAt || applied.firstResponseAt) return
    const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
    let committed: boolean
    if (applied.firstResponseBreachedAt) {
      committed = await commitStamp(
        conversationId,
        { ...applied, firstResponseAt: at.toISOString() },
        at,
        guard
      )
    } else {
      const dueAt = dueAtForSettle(applied.firstResponseDueAt, applied.pausedAt, at)
      const breached = at.getTime() > dueAt.getTime()
      committed = await commitClockEvent(
        conversationId,
        {
          ...applied,
          firstResponseAt: at.toISOString(),
          ...(breached ? { firstResponseBreachedAt: at.toISOString() } : {}),
        },
        breached ? 'first_response_breached' : 'first_response_met',
        dueAt.toISOString(),
        at,
        guard
      )
    }
    if (committed) return
    applied = await loadSlaApplied(conversationId)
  }
}

/**
 * Record the conversation's resolution against the time-to-close clock and log
 * met/breached. Idempotent and a no-op when no SLA is applied or the policy
 * doesn't track time-to-close. If the clock is currently paused, the elapsed
 * pause up to `at` is excluded, see dueAtForSettle. When the sweep already
 * noted the breach (resolutionBreachedAt is set), the close only settles the
 * clock — no second event. `preloaded` lets a caller
 * that already has a fresh `SlaApplied` (e.g. resumeSlaFromSnooze's return, on
 * a direct snoozed -> closed transition) skip the loadSlaApplied SELECT; pass
 * `null` (resume was a no-op) or omit it and the `??` fallback loads it as
 * usual. Guarded and retried on a CAS miss exactly like recordFirstResponse —
 * see that doc comment. A preloaded stamp widens the window between when it
 * was read and when this function writes it (it was already read once by the
 * caller before reaching here), so it is just as likely to be stale as a
 * fresh read: the same guarded-write-then-reload handles both uniformly,
 * degrading a stale preloaded stamp to a reload rather than clobbering
 * whatever is actually on the row.
 */
export async function recordResolution(
  conversationId: ConversationId,
  at: Date = new Date(),
  preloaded?: SlaApplied | null
): Promise<void> {
  let applied = preloaded ?? (await loadSlaApplied(conversationId))
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.timeToCloseDueAt || applied.resolvedAt) return
    const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
    let committed: boolean
    if (applied.resolutionBreachedAt) {
      committed = await commitStamp(
        conversationId,
        { ...applied, resolvedAt: at.toISOString() },
        at,
        guard
      )
    } else {
      const dueAt = dueAtForSettle(applied.timeToCloseDueAt, applied.pausedAt, at)
      const breached = at.getTime() > dueAt.getTime()
      committed = await commitClockEvent(
        conversationId,
        {
          ...applied,
          resolvedAt: at.toISOString(),
          ...(breached ? { resolutionBreachedAt: at.toISOString() } : {}),
        },
        breached ? 'resolution_breached' : 'resolution_met',
        dueAt.toISOString(),
        at,
        guard
      )
    }
    if (committed) return
    applied = await loadSlaApplied(conversationId)
  }
}

/** Shift an ISO instant forward by `ms` milliseconds. */
function shiftIso(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString()
}

/**
 * Pause-on-snooze (support platform §4.6): when a conversation with an active
 * SLA whose policy opted into `pauseOnSnooze` enters 'snoozed', stamp the
 * moment the clock stopped. The stamped deadlines themselves are left
 * untouched here; they only shift once the paused duration is known, on
 * resume. Uses a single guarded UPDATE (matches the appliedAt + pausedAt this
 * call read) so a concurrent apply/pause/resume doesn't get clobbered. If the
 * guard misses, this quietly skips rather than overwriting a newer stamp; the
 * existing read-modify-write race in this domain is out of scope to fully fix.
 * A no-op without an applied SLA, when the policy opted out of pausing, or
 * when the clock is already paused (idempotent against a duplicate event).
 */
export async function pauseSlaOnSnooze(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied || applied.pauseOnSnooze === false || applied.pausedAt) return

  const next: SlaApplied = { ...applied, pausedAt: at.toISOString() }
  const [row] = await db
    .update(conversations)
    .set({ slaApplied: next, updatedAt: at })
    .where(slaStampGuard(conversationId, applied.appliedAt, null))
    .returning({ id: conversations.id })
  if (!row) return

  await db.insert(slaEvents).values({
    conversationId,
    policyId: applied.policyId,
    kind: 'paused',
    meta: { at: at.toISOString() },
  })
}

/**
 * Resume-from-snooze: shift every still-unsettled deadline forward by the
 * paused duration (now - pausedAt) and clear the pause. A deadline whose
 * outcome (firstResponseAt/resolvedAt) is already recorded is left untouched,
 * since it settled against whatever was live at the time, pause or not. A
 * deadline the policy never tracked is null and is likewise left untouched.
 * The shift is a plain wall-clock delta rather than re-run through
 * office-hours math, so on a schedule with closed hours inside the paused
 * span this is a slight approximation; simple and exact for the common 24/7
 * case. Same guarded-UPDATE approach as pauseSlaOnSnooze. A no-op (returning
 * null) without an applied SLA or when the clock isn't currently paused;
 * otherwise returns the post-resume stamp it wrote, so a caller settling a
 * clock right after (e.g. the direct snoozed -> closed hook) can reuse it
 * instead of reloading the row it just wrote.
 */
export async function resumeSlaFromSnooze(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<SlaApplied | null> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied || !applied.pausedAt) return null

  const pausedAt = applied.pausedAt
  const shiftMs = Math.max(0, at.getTime() - new Date(pausedAt).getTime())
  const next: SlaApplied = {
    ...applied,
    pausedAt: null,
    firstResponseDueAt:
      !applied.firstResponseDueAt || applied.firstResponseAt
        ? applied.firstResponseDueAt
        : shiftIso(applied.firstResponseDueAt, shiftMs),
    timeToCloseDueAt:
      !applied.timeToCloseDueAt || applied.resolvedAt
        ? applied.timeToCloseDueAt
        : shiftIso(applied.timeToCloseDueAt, shiftMs),
  }

  const [row] = await db
    .update(conversations)
    .set({ slaApplied: next, updatedAt: at })
    .where(slaStampGuard(conversationId, applied.appliedAt, pausedAt))
    .returning({ id: conversations.id })
  if (!row) return null

  await db.insert(slaEvents).values({
    conversationId,
    policyId: applied.policyId,
    kind: 'resumed',
    meta: { pausedForSecs: Math.round(shiftMs / 1000), at: at.toISOString() },
  })
  return next
}

// Upper bound on conversations handled per sweep run; anything beyond waits a
// minute for the next tick (the SQL filter keeps re-finding them).
const SWEEP_BATCH_LIMIT = 500

// The two stamped clocks the sweep can find overdue, as stamp-field descriptors
// so both run through the one claim-then-log path below.
const SWEEP_CLOCKS = [
  {
    kind: 'first_response_breached',
    dueField: 'firstResponseDueAt',
    settledField: 'firstResponseAt',
    markerField: 'firstResponseBreachedAt',
  },
  {
    kind: 'resolution_breached',
    dueField: 'timeToCloseDueAt',
    settledField: 'resolvedAt',
    markerField: 'resolutionBreachedAt',
  },
] as const

/**
 * The breach sweep (run every minute by sla-breach-sweep-queue): find
 * conversations whose stamped first-response / time-to-close deadline has
 * passed with no settle and no breach noted yet, and record the breach.
 *
 * Exactly-once: each breach is CLAIMED before its event is logged, with a
 * single UPDATE that merges the breach-noted marker into the live stamp. The
 * claim's predicate is slaStampGuard — the same CAS every other stamp writer
 * (pause/resume/settle) uses — narrowed to the clock being claimed: the due
 * date must still be the scanned one (a pause+resume cycle between scan and
 * write keeps pausedAt null but shifts the deadline) and the clock must still
 * be unsettled and unmarked. So a lazy evaluation (agent reply / close), a
 * pause, or a re-apply racing the sweep across its wide scan-to-write span
 * can't produce a duplicate event, and the jsonb merge can never clobber a
 * concurrently-settled stamp.
 *
 * Pause-aware: a stamp whose clock is currently paused (pausedAt set, not yet
 * resumed) never breaches — the scan excludes it in SQL and the loop re-checks
 * in JS. Resume shifts the unsettled deadlines forward by the paused span, so
 * once the conversation leaves snooze the normal scan judges the shifted
 * deadline. Returns the number recorded.
 */
export async function sweepOverdueSlaBreaches(
  at: Date = new Date()
): Promise<{ recorded: number }> {
  const now = at.toISOString() // ISO-8601 compares lexicographically = chronologically
  const rows = await db
    .select({ id: conversations.id, slaApplied: conversations.slaApplied })
    .from(conversations)
    .where(
      and(
        isNotNull(conversations.slaApplied),
        sql`(${conversations.slaApplied} ->> 'pausedAt') IS NULL`,
        sql`(
          ((${conversations.slaApplied} ->> 'firstResponseDueAt') < ${now}
            AND (${conversations.slaApplied} ->> 'firstResponseAt') IS NULL
            AND (${conversations.slaApplied} ->> 'firstResponseBreachedAt') IS NULL)
          OR ((${conversations.slaApplied} ->> 'timeToCloseDueAt') < ${now}
            AND (${conversations.slaApplied} ->> 'resolvedAt') IS NULL
            AND (${conversations.slaApplied} ->> 'resolutionBreachedAt') IS NULL)
        )`
      )
    )
    .limit(SWEEP_BATCH_LIMIT)

  let recorded = 0
  for (const row of rows) {
    // Re-check in JS (the recording rule lives here; SQL only narrows the scan).
    const applied = row.slaApplied as SlaApplied
    if (applied.pausedAt) continue // paused clocks are stopped, never overdue
    for (const clock of SWEEP_CLOCKS) {
      const dueAt = applied[clock.dueField]
      if (!dueAt || applied[clock.settledField] || applied[clock.markerField]) continue
      if (at.getTime() <= new Date(dueAt).getTime()) continue
      const claimed = await db
        .update(conversations)
        .set({
          slaApplied: sql`${conversations.slaApplied} || ${JSON.stringify({
            [clock.markerField]: at.toISOString(),
          })}::jsonb`,
          updatedAt: at,
        })
        .where(
          and(
            slaStampGuard(row.id, applied.appliedAt, null),
            sql`(${conversations.slaApplied} ->> ${clock.dueField}) = ${dueAt}`,
            sql`(${conversations.slaApplied} ->> ${clock.settledField}) IS NULL`,
            sql`(${conversations.slaApplied} ->> ${clock.markerField}) IS NULL`
          )
        )
        .returning({ id: conversations.id })
      if (claimed.length === 0) continue // settled, paused, re-applied, or noted meanwhile
      await insertClockEvent(row.id, applied.policyId, clock.kind, dueAt, at)
      recorded++
    }
  }
  return { recorded }
}

/**
 * Manually remove the active SLA (the agent's overflow action): clear the
 * stamp and log a 'removed' event so reporting can tell removal apart from
 * completion. A no-op (null) when nothing is applied; otherwise returns the
 * updated row so the caller can broadcast the fresh DTO.
 */
export async function removeSlaFromConversation(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<Conversation | null> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied) return null
  const [row] = await db
    .update(conversations)
    .set({ slaApplied: null, updatedAt: at })
    .where(eq(conversations.id, conversationId))
    .returning()
  await db.insert(slaEvents).values({
    conversationId,
    policyId: applied.policyId,
    kind: 'removed',
    meta: { at: at.toISOString() },
  })
  return row ?? null
}
