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
import type { EventConversationRef } from '@/lib/server/events/types'
import { getSlaPolicy } from './sla-policy.service'
import {
  addOfficeHoursSeconds,
  engineScheduleFromWorkspace,
  getScheduleById,
  type EngineSchedule,
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
  // policy. The next-response clock restarts on every customer message, so its
  // due time is NOT computed at apply time — only its target (seconds) is
  // snapshotted here, and rearmNextResponse stamps `nextResponseDueAt` when a
  // visitor message arms a fresh cycle (absent on old stamps = unarmed).
  firstResponseDueAt: string | null
  nextResponseTargetSecs: number | null
  nextResponseDueAt?: string | null
  timeToCloseDueAt: string | null
  // Lazy-eval outcomes: when the first teammate reply / the reply to the
  // current next-response cycle / the resolution landed (set by the breach
  // evaluator), or null while that clock is still open. `nextResponseAt` is
  // cleared by rearmNextResponse each time a new customer message re-arms the
  // clock, so it always refers to the CURRENT cycle.
  firstResponseAt?: string | null
  nextResponseAt?: string | null
  resolvedAt?: string | null
  // Breach-noted markers: set the moment a breach event is logged (by the
  // sweep or the lazy evaluator), so repeated sweeps and a late settle stay
  // exactly-once on the sla_events log. Unset on old stamps = not yet noted.
  firstResponseBreachedAt?: string | null
  nextResponseBreachedAt?: string | null
  resolutionBreachedAt?: string | null
  // Timer-driven workflow-trigger fire markers (support platform §4.6) —
  // DISTINCT from the breach-noted markers above, which exist purely to keep
  // the sla_events reporting log exactly-once and are read/written by
  // recordFirstResponse/recordResolution/sweepOverdueSlaBreaches regardless
  // of whether any workflow cares. These four exist only so
  // sweepApproachingSlaBreaches / sweepSlaBreachTriggers (below) fire
  // conversation.customer_unresponsive's SLA siblings — sla.approaching_breach
  // and sla.breached — at most once per clock per SLA application. Set the
  // moment that trigger's dispatch is enqueued (CAS-guarded the same way as
  // the breach-noted markers), cleared implicitly on a fresh apply (a new
  // `appliedAt` reads every marker below as absent again).
  firstResponseWarningFiredAt?: string | null
  nextResponseWarningFiredAt?: string | null
  resolutionWarningFiredAt?: string | null
  firstResponseBreachTriggerFiredAt?: string | null
  nextResponseBreachTriggerFiredAt?: string | null
  resolutionBreachTriggerFiredAt?: string | null
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
 * set and still exists — holidays included, so the closed dates pause its
 * clocks — else the workspace office-hours schedule from the settings blob
 * (the canonical hours source — the same one Messenger reply expectations and
 * the workflows office-hours condition read). A disabled or unconfigured
 * workspace schedule resolves 24/7, so it never blocks a clock. Exported for
 * the ticket-side twin (ticket-sla.service.ts), whose TTR clock runs on the
 * same per-policy schedule rule.
 */
export async function resolveScheduleFor(policy: SlaPolicy): Promise<EngineSchedule> {
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

/** The active SLA stamped on a conversation, or null when none is applied.
 *  Exported for the ticket-link handoff (ticket-conversation-link.service.ts),
 *  which reads the conversation's stamp to start the linked ticket's TTR clock
 *  under the same policy. */
export async function loadSlaApplied(conversationId: ConversationId): Promise<SlaApplied | null> {
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
export function slaStampGuard(
  conversationId: ConversationId,
  appliedAt: string,
  pausedAt: string | null
) {
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
 * this reduces to the stamped due date (pausedAt is cleared by then). Exported
 * for ticket-sla.service.ts, whose TTR settle judges against the identical
 * pause-adjusted deadline (its pause signal is the ticket's 'pending'
 * category instead of the conversation's 'snoozed').
 */
export function dueAtForSettle(dueAt: string, pausedAt: string | null | undefined, at: Date): Date {
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
 * second BREACH event — but a `first_response_settled_after_breach` event IS
 * logged (meta.overdueSecs carries the lag from the pause-adjusted due date to
 * the settle) so time-after-miss reporting can measure how late it landed.
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
      // Settle-only (the breach event stays exactly-once), but log the late
      // settle itself for time-after-miss reporting.
      committed = await commitClockEvent(
        conversationId,
        { ...applied, firstResponseAt: at.toISOString() },
        'first_response_settled_after_breach',
        dueAtForSettle(applied.firstResponseDueAt, applied.pausedAt, at).toISOString(),
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
 * clock — no second BREACH event — but a `resolution_settled_after_breach`
 * event IS logged (meta.overdueSecs carries the lag from the pause-adjusted
 * due date to the settle) for time-after-miss reporting. `preloaded` lets a caller
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
      // Settle-only (the breach event stays exactly-once), but log the late
      // settle itself for time-after-miss reporting.
      committed = await commitClockEvent(
        conversationId,
        { ...applied, resolvedAt: at.toISOString() },
        'resolution_settled_after_breach',
        dueAtForSettle(applied.timeToCloseDueAt, applied.pausedAt, at).toISOString(),
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

/** Shift an ISO instant forward by `ms` milliseconds. Exported for
 *  ticket-sla.service.ts's resume, which shifts its unsettled TTR deadline by
 *  the same plain wall-clock delta. */
export function shiftIso(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString()
}

/**
 * Arm (or re-arm) the next-response clock on a VISITOR message: stamp
 * `nextResponseDueAt` as the office-hours-aware deadline computed from THIS
 * message's time (each customer message starts a fresh cycle — the latest one
 * wins), and clear the cycle's settle outcome + per-cycle markers so the new
 * cycle can breach/warn/trigger exactly once of its own. A no-op when no SLA
 * is applied, when the policy doesn't track next response, or while the
 * first-response clock is still open (firstResponseAt unset) — the NRT clock
 * never doubles the first-response clock, so the very first customer wait is
 * measured by firstResponseDueAt alone. Old stamps (no nextResponseDueAt
 * field) arm here the same way; absent simply means "not yet armed".
 *
 * The deadline math needs the policy's office-hours schedule, so the policy
 * row is re-read (via the snapshotted policyId) rather than relying on the
 * stamp alone; a since-deleted policy makes this a no-op — the stamp's other
 * clocks are untouched.
 *
 * Guarded and retried on a CAS miss exactly like recordFirstResponse (see its
 * doc comment): a concurrent settle/pause/resume that moved the stamp first
 * wins, and the re-arm recomputes against the freshly reloaded stamp. No
 * sla_events row is logged — arming is stamp state, not a reportable clock
 * event.
 */
export async function rearmNextResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  let applied = await loadSlaApplied(conversationId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.nextResponseTargetSecs || !applied.firstResponseAt) return
    const policy = await getSlaPolicy(applied.policyId)
    if (!policy) return
    const schedule = await resolveScheduleFor(policy)
    const next: SlaApplied = {
      ...applied,
      nextResponseDueAt: addOfficeHoursSeconds(
        schedule,
        at,
        applied.nextResponseTargetSecs
      ).toISOString(),
      nextResponseAt: null,
      nextResponseBreachedAt: null,
      nextResponseWarningFiredAt: null,
      nextResponseBreachTriggerFiredAt: null,
    }
    const committed = await commitStamp(conversationId, next, at, {
      appliedAt: applied.appliedAt,
      pausedAt: applied.pausedAt ?? null,
    })
    if (committed) return
    applied = await loadSlaApplied(conversationId)
  }
}

/**
 * Record a TEAMMATE reply against the armed next-response clock and log
 * met/breached. Idempotent within a cycle (only the first reply after the
 * customer's message counts) and a no-op when no next-response cycle is armed
 * (nextResponseDueAt unset) or none is tracked. Settling judges against
 * dueAtForSettle (pause-adjusted), exactly like recordFirstResponse. When the
 * sweep already noted this cycle's breach (nextResponseBreachedAt is set), the
 * reply only settles the clock — no second BREACH event — but a
 * `next_response_settled_after_breach` event IS logged with meta.overdueSecs
 * (lag from the pause-adjusted due date to the settle), feeding time-after-miss
 * reporting. Guarded and retried on a CAS miss exactly like
 * recordFirstResponse — see that doc comment.
 */
export async function recordNextResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  let applied = await loadSlaApplied(conversationId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.nextResponseDueAt || applied.nextResponseAt) return
    const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
    let committed: boolean
    if (applied.nextResponseBreachedAt) {
      // Settle-only (the breach event stays exactly-once), but log the late
      // settle itself for time-after-miss reporting.
      committed = await commitClockEvent(
        conversationId,
        { ...applied, nextResponseAt: at.toISOString() },
        'next_response_settled_after_breach',
        dueAtForSettle(applied.nextResponseDueAt, applied.pausedAt, at).toISOString(),
        at,
        guard
      )
    } else {
      const dueAt = dueAtForSettle(applied.nextResponseDueAt, applied.pausedAt, at)
      const breached = at.getTime() > dueAt.getTime()
      committed = await commitClockEvent(
        conversationId,
        {
          ...applied,
          nextResponseAt: at.toISOString(),
          ...(breached ? { nextResponseBreachedAt: at.toISOString() } : {}),
        },
        breached ? 'next_response_breached' : 'next_response_met',
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
 * outcome (firstResponseAt/nextResponseAt/resolvedAt) is already recorded is
 * left untouched, since it settled against whatever was live at the time,
 * pause or not. A deadline the policy never tracked (or a next-response cycle
 * never armed) is null and is likewise left untouched.
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
    nextResponseDueAt:
      !applied.nextResponseDueAt || applied.nextResponseAt
        ? applied.nextResponseDueAt
        : shiftIso(applied.nextResponseDueAt, shiftMs),
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

// The three SLA clocks every sweep pass reads, as ONE stamp-field descriptor
// table (support platform §4.6) — merged from what were two nearly-identical
// tables (a SWEEP_CLOCKS for this per-minute reporting sweep, a separate
// TIMER_TRIGGER_CLOCKS for the two 5-minute workflow-trigger sweeps further
// below): `breachedField` here is the SAME stamp field both former tables
// independently named (SWEEP_CLOCKS' `markerField` / TIMER_TRIGGER_CLOCKS'
// `breachNotedField`) — `*BreachedAt`, set the moment this sweep (or the lazy
// evaluator) first notes the breach. `warningMarkerField`/`breachMarkerField`
// are the SEPARATE, independent workflow-trigger fire-once markers — see
// sweepSlaBreachTriggers' doc below for why they're never the same field as
// `breachedField`. `reportKind` is the sla_events `kind` THIS sweep logs;
// `clock` is the public clock name the workflow-trigger sweeps' dispatched
// event payload uses (a different vocabulary — 'first_response_breached' vs
// 'first_response' — so both names are kept, not just one). The next_response
// row's markers are PER-CYCLE: rearmNextResponse clears them (and the settle
// outcome) on every customer message, so each fresh cycle can breach/warn/
// trigger once of its own.
const SLA_CLOCKS = [
  {
    reportKind: 'first_response_breached',
    clock: 'first_response',
    dueField: 'firstResponseDueAt',
    settledField: 'firstResponseAt',
    breachedField: 'firstResponseBreachedAt',
    warningMarkerField: 'firstResponseWarningFiredAt',
    breachMarkerField: 'firstResponseBreachTriggerFiredAt',
  },
  {
    reportKind: 'next_response_breached',
    clock: 'next_response',
    dueField: 'nextResponseDueAt',
    settledField: 'nextResponseAt',
    breachedField: 'nextResponseBreachedAt',
    warningMarkerField: 'nextResponseWarningFiredAt',
    breachMarkerField: 'nextResponseBreachTriggerFiredAt',
  },
  {
    reportKind: 'resolution_breached',
    clock: 'resolution',
    dueField: 'timeToCloseDueAt',
    settledField: 'resolvedAt',
    breachedField: 'resolutionBreachedAt',
    warningMarkerField: 'resolutionWarningFiredAt',
    breachMarkerField: 'resolutionBreachTriggerFiredAt',
  },
] as const

type SlaClock = (typeof SLA_CLOCKS)[number]

/** A row scanAndClaimSlaClocks selects: the SLA stamp plus the
 *  EventConversationRef fields the two timer-trigger sweeps need to build
 *  each claimed candidate's `conversation` ref (webhook payload parity). */
interface SlaSweepRow {
  id: ConversationId
  slaApplied: unknown
  status: string
  channel: string
  priority: string
  assignedTeamId: string | null
}

/** Build the EventConversationRef every sibling conversation event embeds,
 *  from a scanAndClaimSlaClocks row. */
function conversationRefFromRow(row: SlaSweepRow): EventConversationRef {
  return {
    id: row.id,
    status: row.status as EventConversationRef['status'],
    channel: row.channel as EventConversationRef['channel'],
    priority: row.priority as EventConversationRef['priority'],
    assignedTeamId: row.assignedTeamId,
  }
}

/**
 * The generic scan-and-claim skeleton shared by every SLA sweep pass below
 * (sweepOverdueSlaBreaches here, plus sweepApproachingSlaBreaches /
 * sweepSlaBreachTriggers further down): fetch every conversation with an
 * active (non-paused) SLA whose stamp satisfies `buildWindowSql` (batched at
 * SWEEP_BATCH_LIMIT), then for each of SLA_CLOCKS' three clocks on each row,
 * re-check `isEligible` in JS (SQL only narrows the scan; the
 * recording/claiming rule always lives in JS, per every sweep in this module)
 * and, if still eligible, atomically claim `markerField(clock)` — CAS-guarded
 * by slaStampGuard the same way every stamp writer in this module is, plus
 * whatever `extraUnsetFields(clock)` names must ALSO still be unset under
 * that same guard (only sweepOverdueSlaBreaches uses this, to re-check
 * `settledField` in the claim itself — see its own call site for why).
 * `onClaimed` runs only after a landed claim: the one place the three
 * passes actually diverge (log an sla_events row vs. push a workflow-trigger
 * candidate).
 *
 * Deliberately status-blind: none of the three sweeps below filter on
 * `conversations.status` at all (contrast workflow-sweep.ts's
 * scanUnresponsiveForWorkflow, which explicitly excludes closed/snoozed
 * conversations by SQL filter for the customer/teammate_unresponsive pair).
 * A snoozed conversation only stops its clock when the policy opted into
 * `pauseOnSnooze` (pauseSlaOnSnooze/resumeSlaFromSnooze, above) — under a
 * no-pause policy it keeps running and can legitimately breach while
 * snoozed. A closed conversation whose first-response (or resolution) clock
 * was never settled before close is a real, reportable fact — "nobody
 * responded before this was closed" — not a scan artifact to suppress.
 * Whether that fact is still actionable for a given workflow (e.g. "don't
 * reopen a closed conversation just because it breached") is left to that
 * workflow's OWN condition/branch on `conversation.status`, the same way any
 * other trigger's downstream filtering works — it is not baked into the scan.
 */
async function scanAndClaimSlaClocks(
  at: Date,
  buildWindowSql: (nowIso: string) => ReturnType<typeof sql>,
  isEligible: (clock: SlaClock, applied: SlaApplied, dueAt: string) => boolean,
  markerField: (clock: SlaClock) => keyof SlaApplied,
  extraUnsetFields: (clock: SlaClock) => (keyof SlaApplied)[],
  onClaimed: (
    row: SlaSweepRow,
    applied: SlaApplied,
    clock: SlaClock,
    dueAt: string
  ) => Promise<void>
): Promise<void> {
  const nowIso = at.toISOString() // ISO-8601 compares lexicographically = chronologically
  const rows = await db
    .select({
      id: conversations.id,
      slaApplied: conversations.slaApplied,
      // Only sweepApproachingSlaBreaches/sweepSlaBreachTriggers actually use
      // these (to build each claimed candidate's EventConversationRef —
      // support platform §4.6, webhook payload parity); sweepOverdueSlaBreaches
      // ignores them. Selected unconditionally rather than threading a second
      // query shape through this shared skeleton for one caller.
      status: conversations.status,
      channel: conversations.channel,
      priority: conversations.priority,
      assignedTeamId: conversations.assignedTeamId,
    })
    .from(conversations)
    .where(
      and(
        isNotNull(conversations.slaApplied),
        sql`(${conversations.slaApplied} ->> 'pausedAt') IS NULL`,
        // Redundant given buildWindowSql's own OR'd window below (every
        // candidate row already satisfies one arm, since each OR branch
        // requires its own clock's due set + settledField IS NULL) — repeated
        // here VERBATIM as its own top-level AND clause, matching
        // conversations_sla_unsettled_idx's predicate (migration 0187, widened
        // by 0213 for the next-response arm / schema/conversation.ts), so the
        // planner can prove the partial index applies via a literal clause
        // match instead of having to reason through the OR structure itself.
        // The next-response arm is `dueAt set AND unsettled` (not just
        // `nextResponseAt IS NULL`, which — unlike the other two outcomes —
        // is absent-until-settled and would otherwise be true for nearly
        // every stamp, gutting the partial index back to 0186's
        // `IS NOT NULL` selectivity): the only rows it adds beyond the other
        // two arms are an ARMED next-response cycle on a conversation whose
        // first-response AND resolution clocks both already settled (e.g. a
        // customer re-pinging a reopened, resolved thread).
        sql`((${conversations.slaApplied} ->> 'firstResponseAt') IS NULL OR (${conversations.slaApplied} ->> 'resolvedAt') IS NULL OR ((${conversations.slaApplied} ->> 'nextResponseDueAt') IS NOT NULL AND (${conversations.slaApplied} ->> 'nextResponseAt') IS NULL))`,
        buildWindowSql(nowIso)
      )
    )
    .limit(SWEEP_BATCH_LIMIT)

  for (const row of rows) {
    // Re-check in JS (the recording rule lives here; SQL only narrows the scan).
    const applied = row.slaApplied as SlaApplied
    if (applied.pausedAt) continue // paused clocks are stopped, never eligible
    for (const clock of SLA_CLOCKS) {
      const dueAt = applied[clock.dueField]
      if (!dueAt || !isEligible(clock, applied, dueAt)) continue
      const landed = await claimSlaClockMarker(
        row.id,
        applied,
        clock.dueField,
        markerField(clock),
        dueAt,
        at,
        extraUnsetFields(clock)
      )
      if (!landed) continue // settled, paused, re-applied, or claimed meanwhile
      await onClaimed(row, applied, clock, dueAt)
    }
  }
}

/**
 * The breach sweep (run every minute by sla-breach-sweep-queue): find
 * conversations whose stamped first-response / next-response / time-to-close
 * deadline has
 * passed with no settle and no breach noted yet, and record the breach.
 *
 * Exactly-once: each breach is CLAIMED before its event is logged, with a
 * single UPDATE that merges the breach-noted marker into the live stamp. The
 * claim's predicate is slaStampGuard — the same CAS every other stamp writer
 * (pause/resume/settle) uses — narrowed to the clock being claimed: the due
 * date must still be the scanned one (a pause+resume cycle between scan and
 * write keeps pausedAt null but shifts the deadline) and the clock must still
 * be unsettled and unmarked (this sweep's claim ALSO re-checks `settledField`
 * itself, unlike the two workflow-trigger sweeps below — passed here as
 * `extraUnsetFields` — closing a narrow race a lazy settle landing between
 * this sweep's SELECT and its own UPDATE would otherwise slip through: the
 * settle doesn't change `appliedAt`/`pausedAt`, so slaStampGuard alone
 * wouldn't catch it). So a lazy evaluation (agent reply / close), a pause, or
 * a re-apply racing the sweep across its wide scan-to-write span can't
 * produce a duplicate event, and the jsonb merge can never clobber a
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
  let recorded = 0
  await scanAndClaimSlaClocks(
    at,
    (nowIso) => sql`(
          ((${conversations.slaApplied} ->> 'firstResponseDueAt') < ${nowIso}
            AND (${conversations.slaApplied} ->> 'firstResponseAt') IS NULL
            AND (${conversations.slaApplied} ->> 'firstResponseBreachedAt') IS NULL)
          OR ((${conversations.slaApplied} ->> 'nextResponseDueAt') < ${nowIso}
            AND (${conversations.slaApplied} ->> 'nextResponseAt') IS NULL
            AND (${conversations.slaApplied} ->> 'nextResponseBreachedAt') IS NULL)
          OR ((${conversations.slaApplied} ->> 'timeToCloseDueAt') < ${nowIso}
            AND (${conversations.slaApplied} ->> 'resolvedAt') IS NULL
            AND (${conversations.slaApplied} ->> 'resolutionBreachedAt') IS NULL)
        )`,
    (clock, applied, dueAt) =>
      !applied[clock.settledField] &&
      !applied[clock.breachedField] &&
      at.getTime() > new Date(dueAt).getTime(),
    (clock) => clock.breachedField,
    (clock) => [clock.settledField],
    async (row, applied, clock, dueAt) => {
      await insertClockEvent(row.id, applied.policyId, clock.reportKind, dueAt, at)
      recorded++
    }
  )
  return { recorded }
}

// ---------------------------------------------------------------------------
// Timer-driven workflow triggers (support platform §4.6): sla.approaching_breach
// / sla.breached. Both are called from workflow-sweep.ts's 5-minute tick (NOT
// the per-minute sla-breach-sweep-queue above, which exists purely for
// sla_events reporting and is otherwise unrelated) and dispatch through the
// STANDARD multi-workflow fan-out (dispatchWorkflowTrigger, via
// dispatchSlaApproachingBreach/dispatchSlaBreached -> processEvent), unlike
// the conversation.customer_unresponsive / teammate_unresponsive pair in
// event-trigger.ts, which routes to one pre-selected workflow instead.
//
// Why the difference: that pair's fire-once dedupe is a BullMQ jobId keyed by
// (workflowId, conversationId, silence-start), so scanning "per live workflow,
// with that workflow's own threshold" costs nothing extra — each workflow
// naturally gets its own independent firing. SLA's fire-once dedupe is a
// CAS-guarded marker stamped on `sla_applied` (below), which — per the task
// spec — is scoped per (conversation, clock), not per workflow: there is only
// ONE `firstResponseWarningFiredAt` slot per SLA application, not one per
// live workflow. So when more than one live workflow subscribes to
// sla.approaching_breach with DIFFERENT `breachLeadMinutes`, there is no way
// to fire each independently off a single scalar marker — workflow-sweep.ts
// resolves this by scanning at the WIDEST (maximum) configured lead across
// every live workflow of that trigger type, claims the ONE marker at that
// moment, and dispatches to every live workflow together. A workflow
// configured with a NARROWER lead than the winning one is notified earlier
// than it asked for. This is a deliberate, documented v1 simplification
// (per-workflow independent SLA warning timing is deferred) rather than a
// bug: expanding the marker to a per-workflow map is the natural follow-up if
// multiple SLA-trigger workflows with different leads turns out to matter in
// practice.
// ---------------------------------------------------------------------------

/** One (conversation, clock) pair a timer-trigger sweep claimed and needs
 *  dispatched — workflow-sweep.ts turns each into a dispatchSlaApproachingBreach
 *  / dispatchSlaBreached call. */
export interface SlaTimerTriggerCandidate {
  conversationId: ConversationId
  conversation: EventConversationRef
  policyId: SlaPolicyId
  clock: 'first_response' | 'next_response' | 'resolution'
  dueAt: string
}

/** Claim `markerField` on `conversationId`'s stamp via the same guarded
 *  jsonb-merge CAS every stamp writer in this module uses (slaStampGuard),
 *  narrowed to the exact due date and to the marker still being unset —
 *  optionally ALSO re-checking any `extraUnsetFields` under that same guard
 *  (only sweepOverdueSlaBreaches passes any, to re-check `settledField`
 *  itself; see its own doc for why). Returns whether the claim landed. Shared
 *  by all three sweep passes above/below (via scanAndClaimSlaClocks) so the
 *  CAS predicate can't drift between them. */
async function claimSlaClockMarker(
  conversationId: ConversationId,
  applied: SlaApplied,
  dueField: string,
  markerField: string,
  dueAt: string,
  at: Date,
  extraUnsetFields: string[] = []
): Promise<boolean> {
  const claimed = await db
    .update(conversations)
    .set({
      slaApplied: sql`${conversations.slaApplied} || ${JSON.stringify({
        [markerField]: at.toISOString(),
      })}::jsonb`,
      updatedAt: at,
    })
    .where(
      and(
        slaStampGuard(conversationId, applied.appliedAt, null),
        sql`(${conversations.slaApplied} ->> ${dueField}) = ${dueAt}`,
        sql`(${conversations.slaApplied} ->> ${markerField}) IS NULL`,
        ...extraUnsetFields.map((field) => sql`(${conversations.slaApplied} ->> ${field}) IS NULL`)
      )
    )
    .returning({ id: conversations.id })
  return claimed.length > 0
}

/**
 * Scan for conversations whose unsettled clock enters the approaching-breach
 * lead window (`due - leadMinutes <= now < due`) and claim
 * `*WarningFiredAt` for each — CAS-guarded exactly like sweepOverdueSlaBreaches's
 * `*BreachedAt` claim, just on a different marker field (see this section's
 * module doc for why `leadMinutes` is a single value, not per-workflow).
 * Pause-aware the same way sweepOverdueSlaBreaches is: a currently-paused
 * clock never approaches (excluded in SQL and re-checked in JS). Already-due
 * clocks are excluded too — those are sla.breached's job below, not a warning.
 * Returns the claimed candidates for the caller (workflow-sweep.ts) to
 * dispatch.
 */
export async function sweepApproachingSlaBreaches(
  leadMinutes: number,
  at: Date = new Date()
): Promise<SlaTimerTriggerCandidate[]> {
  const horizon = new Date(at.getTime() + leadMinutes * 60_000).toISOString()
  const claimed: SlaTimerTriggerCandidate[] = []
  await scanAndClaimSlaClocks(
    at,
    (nowIso) => sql`(
          ((${conversations.slaApplied} ->> 'firstResponseDueAt') > ${nowIso}
            AND (${conversations.slaApplied} ->> 'firstResponseDueAt') <= ${horizon}
            AND (${conversations.slaApplied} ->> 'firstResponseAt') IS NULL
            AND (${conversations.slaApplied} ->> 'firstResponseBreachedAt') IS NULL
            AND (${conversations.slaApplied} ->> 'firstResponseWarningFiredAt') IS NULL)
          OR ((${conversations.slaApplied} ->> 'nextResponseDueAt') > ${nowIso}
            AND (${conversations.slaApplied} ->> 'nextResponseDueAt') <= ${horizon}
            AND (${conversations.slaApplied} ->> 'nextResponseAt') IS NULL
            AND (${conversations.slaApplied} ->> 'nextResponseBreachedAt') IS NULL
            AND (${conversations.slaApplied} ->> 'nextResponseWarningFiredAt') IS NULL)
          OR ((${conversations.slaApplied} ->> 'timeToCloseDueAt') > ${nowIso}
            AND (${conversations.slaApplied} ->> 'timeToCloseDueAt') <= ${horizon}
            AND (${conversations.slaApplied} ->> 'resolvedAt') IS NULL
            AND (${conversations.slaApplied} ->> 'resolutionBreachedAt') IS NULL
            AND (${conversations.slaApplied} ->> 'resolutionWarningFiredAt') IS NULL)
        )`,
    (clock, applied, dueAt) => {
      if (applied[clock.settledField] || applied[clock.breachedField]) return false
      if (applied[clock.warningMarkerField]) return false
      const dueMs = new Date(dueAt).getTime()
      return dueMs > at.getTime() && dueMs <= at.getTime() + leadMinutes * 60_000
    },
    (clock) => clock.warningMarkerField,
    () => [],
    async (row, applied, clock, dueAt) => {
      claimed.push({
        conversationId: row.id,
        conversation: conversationRefFromRow(row),
        policyId: applied.policyId,
        clock: clock.clock,
        dueAt,
      })
    }
  )
  return claimed
}

/**
 * Scan for conversations whose unsettled clock has passed its due date and
 * claim `*BreachTriggerFiredAt` for each — independent of (and in addition
 * to) sweepOverdueSlaBreaches's own `*BreachedAt` claim above: different
 * marker field, so whichever of the per-minute reporting sweep or this
 * 5-minute trigger sweep runs first never blocks the other. No lead time:
 * this fires the instant `now >= due`, same as sweepOverdueSlaBreaches's own
 * breach detection. Returns the claimed candidates for the caller
 * (workflow-sweep.ts) to dispatch.
 */
export async function sweepSlaBreachTriggers(
  at: Date = new Date()
): Promise<SlaTimerTriggerCandidate[]> {
  const claimed: SlaTimerTriggerCandidate[] = []
  await scanAndClaimSlaClocks(
    at,
    (nowIso) => sql`(
          ((${conversations.slaApplied} ->> 'firstResponseDueAt') < ${nowIso}
            AND (${conversations.slaApplied} ->> 'firstResponseAt') IS NULL
            AND (${conversations.slaApplied} ->> 'firstResponseBreachTriggerFiredAt') IS NULL)
          OR ((${conversations.slaApplied} ->> 'nextResponseDueAt') < ${nowIso}
            AND (${conversations.slaApplied} ->> 'nextResponseAt') IS NULL
            AND (${conversations.slaApplied} ->> 'nextResponseBreachTriggerFiredAt') IS NULL)
          OR ((${conversations.slaApplied} ->> 'timeToCloseDueAt') < ${nowIso}
            AND (${conversations.slaApplied} ->> 'resolvedAt') IS NULL
            AND (${conversations.slaApplied} ->> 'resolutionBreachTriggerFiredAt') IS NULL)
        )`,
    (clock, applied, dueAt) => {
      if (applied[clock.settledField]) return false
      if (applied[clock.breachMarkerField]) return false
      return at.getTime() > new Date(dueAt).getTime()
    },
    (clock) => clock.breachMarkerField,
    () => [],
    async (row, applied, clock, dueAt) => {
      claimed.push({
        conversationId: row.id,
        conversation: conversationRefFromRow(row),
        policyId: applied.policyId,
        clock: clock.clock,
        dueAt,
      })
    }
  )
  return claimed
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
