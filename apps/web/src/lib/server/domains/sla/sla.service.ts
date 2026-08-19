/**
 * Apply-SLA (support platform §4.6): stamp a policy's clocks onto a conversation
 * and open its timeline. An SLA is applied ONLY here — the Apply-SLA workflow
 * action calls this; it is never matched ambiently. The computed deadlines are
 * office-hours aware and SNAPSHOT the policy's targets, so a later edit to the
 * policy never moves a clock that is already running on a live conversation.
 * Breach evaluation reads `sla_applied` and appends to the append-only
 * `sla_events` log, from two directions that share one recording path:
 * lazily on agent reply / close (sla.event-hooks.ts), and via the per-minute
 * sweep (sla.sweep.ts's sweepOverdueSlaBreaches, run by
 * sla-breach-sweep-queue.ts) for deadlines that pass with no event. The
 * timer-driven workflow-trigger scans live in sla.sweep.ts too.
 */
import {
  db,
  and,
  eq,
  sql,
  conversations,
  slaEvents,
  type Conversation,
  type SlaPolicy,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { ConversationId, SlaPolicyId } from '@quackback/ids'
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
 *
 * FIELD OWNERSHIP (the write contract every mutator below honors): no writer
 * ever rewrites the whole stamp. Each writer merges ONLY the fields it owns
 * into the live stamp via jsonb `||` (see commitStamp), guarded by the
 * identity CAS (slaStampGuard) plus content predicates on the fields its
 * computation depends on — so two writers touching DISJOINT fields both land
 * (no lost update), and two writers touching the SAME field are serialized by
 * that field's own predicate (the loser reloads + recomputes instead of
 * clobbering). Ownership:
 *
 *  - settle recorders (recordFirstResponse/recordNextResponse/
 *    recordResolution) own their clock's `*At` outcome and, when the settle
 *    itself notes the breach, that clock's `*BreachedAt`;
 *  - pauseSlaOnSnooze/resumeSlaFromSnooze own `pausedAt` and the pause-shift
 *    of the still-unsettled `*DueAt` deadlines;
 *  - rearmNextResponse owns the next-response cycle fields
 *    (`nextResponseDueAt`, `nextResponseAt`, and the per-cycle markers) — a
 *    fresh customer message replaces the cycle wholesale, and the merge's
 *    explicit nulls clear the old cycle's fields (jsonb-merge sets the key to
 *    null, which `->> field IS NULL` guards and falsy JS readers both treat
 *    as unset);
 *  - the sweeps (sla.sweep.ts) own the `*BreachedAt` / `*WarningFiredAt` /
 *    `*BreachTriggerFiredAt` markers.
 */
export type SlaApplied = {
  policyId: SlaPolicyId
  // Snapshot for display without a join back to the (possibly edited/deleted) policy.
  policyName: string
  appliedAt: string // ISO
  // The office-hours schedule the policy's clocks run on, snapshotted at apply
  // time (the resolved { timezone, intervals, holidays } — already the ENGINE
  // shape, so no re-resolution is ever needed). rearmNextResponse computes its
  // fresh cycle deadline from THIS snapshot, not from the live policy: an
  // archived policy keeps its armed clocks re-arming (matching how FRT/TTC
  // already behave), and a mid-cycle schedule edit never moves a clock that
  // is already running — the same snapshot contract the deadlines themselves
  // keep. Absent on stamps written before this field existed: rearmNextResponse
  // falls back to resolving the live policy's schedule (the pre-snapshot
  // behavior — an archived policy's legacy stamps simply stop re-arming, the
  // documented backfill tolerance).
  scheduleSnapshot?: EngineSchedule | null
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
  // of whether any workflow cares. These four exist only so sla.sweep.ts's
  // sweepApproachingSlaBreaches / sweepSlaBreachTriggers fire
  // conversation.customer_unresponsive's SLA siblings — sla.approaching_breach
  // and sla.breached — at most once per clock per SLA application. Set the
  // moment that trigger's dispatch is enqueued (claimed CAS-guarded after the
  // enqueue — see sla.sweep.ts's claimSlaTimerTriggerMarker), cleared
  // implicitly on a fresh apply (a new `appliedAt` reads every marker below
  // as absent again).
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
 *
 * Apply-while-paused: a conversation that is ALREADY 'snoozed' under a
 * pauseOnSnooze policy gets its clock stamped already-paused (pausedAt =
 * appliedAt) — the snooze predated the apply, so no pause event will ever
 * arrive for it, and without the seed the fresh clock would run (and could
 * breach) while the conversation sits snoozed.
 */
export async function applySlaToConversation(
  conversationId: ConversationId,
  policyId: SlaPolicyId,
  at: Date = new Date()
): Promise<SlaApplied> {
  const policy = await getSlaPolicy(policyId)
  if (!policy) throw new Error(`SLA policy ${policyId} not found`)
  const schedule = await resolveScheduleFor(policy)
  const [convo] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  const applied: SlaApplied = {
    policyId: policy.id,
    policyName: policy.name,
    appliedAt: at.toISOString(),
    // The schedule snapshot is the stamp's own (see the field's doc on
    // SlaApplied): a trimmed copy, never the live row/blob reference.
    scheduleSnapshot: {
      timezone: schedule.timezone,
      intervals: schedule.intervals,
      holidays: schedule.holidays ?? [],
    },
    firstResponseDueAt: policy.firstResponseTargetSecs
      ? addOfficeHoursSeconds(schedule, at, policy.firstResponseTargetSecs).toISOString()
      : null,
    nextResponseTargetSecs: policy.nextResponseTargetSecs ?? null,
    timeToCloseDueAt: policy.timeToCloseTargetSecs
      ? addOfficeHoursSeconds(schedule, at, policy.timeToCloseTargetSecs).toISOString()
      : null,
    firstResponseAt: null,
    pauseOnSnooze: policy.pauseOnSnooze,
    pausedAt: convo?.status === 'snoozed' && policy.pauseOnSnooze ? at.toISOString() : null,
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
 * The identity half of the CAS guard shared by every writer of
 * `conversations.sla_applied` (pause/resume/settle/re-arm/sweep claims, all
 * via commitStamp): the update only lands while the stamp is still the exact
 * one the caller read from — `appliedAt` identifies which SLA application it
 * is, `pausedAt` identifies which pause state (or its absence, `null`) the
 * caller computed its write from. A miss means a concurrent
 * apply/pause/resume already moved the stamp, and that write must win over
 * this one rather than get overwritten. Field-level races between writers
 * that change NEITHER guard field (two settles, a settle vs a sweep claim)
 * are caught by the content predicates commitStamp layers on top — see
 * StampContentGuard.
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
 *  evaluator and the sweep record with. Takes an executor so the event can
 *  travel in the same transaction as the stamp write it belongs to (see
 *  commitClockEvent). Exported for sla.sweep.ts's reporting pass, whose
 *  claim + insert pair is atomic the same way. */
export async function insertClockEvent(
  conversationId: ConversationId,
  policyId: SlaPolicyId,
  kind: string,
  dueAt: string,
  at: Date,
  executor: StampExecutor = db
): Promise<void> {
  const overdueMs = at.getTime() - new Date(dueAt).getTime()
  await executor.insert(slaEvents).values({
    conversationId,
    policyId,
    kind,
    meta: { dueAt, at: at.toISOString(), overdueSecs: Math.max(0, Math.round(overdueMs / 1000)) },
  })
}

/** The executor the stamp writers run against: the global db, or the
 *  transaction handle when a stamp write travels with its event insert (see
 *  commitClockEvent) so the pair lands atomically or not at all. */
export type StampExecutor = Database | Transaction

/**
 * The content predicates a stamp merge-write pins BEYOND the identity CAS
 * (slaStampGuard). Two shapes, both evaluated against the live row at write
 * time:
 *
 *  - `unsetFields` must still be unset (`->> field IS NULL`) — the
 *    double-write guard. A concurrent writer that already stamped one of
 *    these fields wins; this write misses instead of clobbering it or
 *    double-logging its event. A settle guards on its own `*At` outcome (a
 *    second concurrent settle loses) and, when it logs the breach itself, on
 *    the breach-noted marker (a sweep that claimed it first wins).
 *  - `pinnedFields` must still equal the exact values the caller computed its
 *    patch from (`->> field = value`, or IS NULL for a null pin) — the
 *    stale-read guard. A concurrent write that moved one of these fields
 *    invalidates the computation, so this write must miss and let the caller
 *    reload + recompute against fresh state (rearmNextResponse pins the exact
 *    `nextResponseDueAt` it is replacing).
 */
export interface StampContentGuard {
  unsetFields?: (keyof SlaApplied)[]
  pinnedFields?: Partial<Record<keyof SlaApplied, string | null>>
}

/**
 * Merge a stamp mutation into the live stamp — the ONE write primitive every
 * stamp mutator in this domain uses (directly, or under commitClockEvent when
 * the mutation travels with a clock event). The write contract has two halves:
 *
 *  1. MERGE, never rewrite: `sla_applied = sla_applied || patch`, where
 *     `patch` carries ONLY the fields this writer owns (the ownership map on
 *     SlaApplied). A whole-stamp write would resurrect stale values over any
 *     field a concurrent writer changed between this writer's read and write;
 *     the jsonb merge leaves every field not in the patch untouched, so
 *     disjoint writers (e.g. a settle and a pause landing together) both keep
 *     their fields. An explicit null in the patch sets the key to jsonb null
 *     (rearmNextResponse's cycle clear), which `->> field IS NULL` guards and
 *     falsy JS readers both treat as unset.
 *  2. GUARD the merge: the identity CAS (slaStampGuard on the appliedAt +
 *     pausedAt the caller computed from) plus `content` — the field-level
 *     predicates above. A miss means a concurrent writer already moved the
 *     state this computation depended on, and that writer must win rather
 *     than get clobbered.
 *
 * Returns whether the write landed; a caller whose guard misses must reload
 * the stamp and recompute before retrying (see recordFirstResponse/
 * recordResolution), the same trade-off pauseSlaOnSnooze documents. Also used
 * for settling a clock whose breach the sweep already logged (the event must
 * stay exactly-once), and by sla.sweep.ts's marker claims.
 */
export async function commitStamp(
  conversationId: ConversationId,
  patch: Partial<SlaApplied>,
  at: Date,
  guard: { appliedAt: string; pausedAt: string | null },
  content: StampContentGuard = {},
  executor: StampExecutor = db
): Promise<boolean> {
  const [row] = await executor
    .update(conversations)
    .set({
      slaApplied: sql`${conversations.slaApplied} || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: at,
    })
    .where(
      and(
        slaStampGuard(conversationId, guard.appliedAt, guard.pausedAt),
        ...(content.unsetFields ?? []).map(
          (field) => sql`(${conversations.slaApplied} ->> ${field}) IS NULL`
        ),
        ...Object.entries(content.pinnedFields ?? {}).map(([field, value]) =>
          value === null
            ? sql`(${conversations.slaApplied} ->> ${field}) IS NULL`
            : sql`(${conversations.slaApplied} ->> ${field}) = ${value}`
        )
      )
    )
    .returning({ id: conversations.id })
  return Boolean(row)
}

/** Persist a stamp mutation + append one clock event in a single spot — and,
 *  crucially, in a single TRANSACTION: the event is the durable record of the
 *  stamp change, so the two must land atomically or not at all (a failure
 *  between them would otherwise leave the log disagreeing with the stamp —
 *  e.g. a settled clock with no settle event, or vice versa). Same guarded
 *  merge as commitStamp — the event is logged only when the stamp write
 *  landed, and a guard miss commits nothing. */
async function commitClockEvent(
  conversationId: ConversationId,
  policyId: SlaPolicyId,
  patch: Partial<SlaApplied>,
  kind: string,
  dueAt: string,
  at: Date,
  guard: { appliedAt: string; pausedAt: string | null },
  content: StampContentGuard
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await commitStamp(conversationId, patch, at, guard, content, tx))) return false
    await insertClockEvent(conversationId, policyId, kind, dueAt, at, tx)
    return true
  })
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
      // settle itself for time-after-miss reporting. The content CAS re-checks
      // the outcome field itself: a concurrent settle that landed first owns
      // it, and this write must miss rather than double-log the settle.
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        { firstResponseAt: at.toISOString() },
        'first_response_settled_after_breach',
        dueAtForSettle(applied.firstResponseDueAt, applied.pausedAt, at).toISOString(),
        at,
        guard,
        { unsetFields: ['firstResponseAt'] }
      )
    } else {
      const dueAt = dueAtForSettle(applied.firstResponseDueAt, applied.pausedAt, at)
      const breached = at.getTime() > dueAt.getTime()
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        breached
          ? { firstResponseAt: at.toISOString(), firstResponseBreachedAt: at.toISOString() }
          : { firstResponseAt: at.toISOString() },
        breached ? 'first_response_breached' : 'first_response_met',
        dueAt.toISOString(),
        at,
        guard,
        // When this settle logs the breach itself, the breach-noted marker is
        // part of the content CAS too: a sweep claim that landed first owns
        // it, and this settle must miss + reload into the settle-after-breach
        // path above rather than double-log the breach.
        {
          unsetFields: breached
            ? ['firstResponseAt', 'firstResponseBreachedAt']
            : ['firstResponseAt'],
        }
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
      // settle itself for time-after-miss reporting. The content CAS re-checks
      // the outcome field itself: a concurrent settle that landed first owns
      // it, and this write must miss rather than double-log the settle.
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        { resolvedAt: at.toISOString() },
        'resolution_settled_after_breach',
        dueAtForSettle(applied.timeToCloseDueAt, applied.pausedAt, at).toISOString(),
        at,
        guard,
        { unsetFields: ['resolvedAt'] }
      )
    } else {
      const dueAt = dueAtForSettle(applied.timeToCloseDueAt, applied.pausedAt, at)
      const breached = at.getTime() > dueAt.getTime()
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        breached
          ? { resolvedAt: at.toISOString(), resolutionBreachedAt: at.toISOString() }
          : { resolvedAt: at.toISOString() },
        breached ? 'resolution_breached' : 'resolution_met',
        dueAt.toISOString(),
        at,
        guard,
        // See recordFirstResponse for why the breach-noted marker joins the
        // content CAS when this settle logs the breach itself.
        { unsetFields: breached ? ['resolvedAt', 'resolutionBreachedAt'] : ['resolvedAt'] }
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
 * The deadline math runs on the stamp's OWN scheduleSnapshot (see SlaApplied),
 * never the live policy: an archived (soft-deleted) policy keeps its armed
 * clocks re-arming, and a mid-cycle schedule edit never moves a running
 * clock — the stamp's snapshot contract. Stamps written before the snapshot
 * existed fall back to resolving the live policy's schedule (the pre-snapshot
 * behavior, including its archived-policy no-op — the documented backfill
 * tolerance).
 *
 * Guarded and retried on a CAS miss exactly like recordFirstResponse (see its
 * doc comment). Beyond the identity CAS, the re-arm PINS the exact
 * `nextResponseDueAt` it is replacing (see StampContentGuard): the merge
 * clears `nextResponseAt` as part of the fresh cycle, so if a concurrent
 * writer moved the cycle between read and write — a resume's due shift, or a
 * sibling re-arm — this computation is stale and must miss rather than
 * resurrect the state it read over the newer cycle. A settle racing the
 * re-arm touches only `nextResponseAt` — a field the re-arm owns and
 * legitimately resets for the new cycle — so the merge itself can never tear
 * the stamp; ordering between the two is decided by whichever lands first.
 * No sla_events row is logged — arming is stamp state, not a reportable clock
 * event.
 */
export async function rearmNextResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  let applied = await loadSlaApplied(conversationId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.nextResponseTargetSecs || !applied.firstResponseAt) return
    const schedule = applied.scheduleSnapshot ?? (await legacyScheduleFor(applied.policyId))
    if (!schedule) return
    const committed = await commitStamp(
      conversationId,
      {
        nextResponseDueAt: addOfficeHoursSeconds(
          schedule,
          at,
          applied.nextResponseTargetSecs
        ).toISOString(),
        nextResponseAt: null,
        nextResponseBreachedAt: null,
        nextResponseWarningFiredAt: null,
        nextResponseBreachTriggerFiredAt: null,
      },
      at,
      { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null },
      { pinnedFields: { nextResponseDueAt: applied.nextResponseDueAt ?? null } }
    )
    if (committed) return
    applied = await loadSlaApplied(conversationId)
  }
}

/** The pre-scheduleSnapshot schedule source: resolve the LIVE policy's
 *  schedule for a stamp that carries no snapshot of its own. Returns null
 *  when the policy is gone (deleted/archived) — the pre-snapshot behavior,
 *  kept only for stamps written before the snapshot existed. */
async function legacyScheduleFor(policyId: SlaPolicyId): Promise<EngineSchedule | null> {
  const policy = await getSlaPolicy(policyId)
  if (!policy) return null
  return resolveScheduleFor(policy)
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
      // settle itself for time-after-miss reporting. The content CAS re-checks
      // the outcome field itself: a concurrent settle that landed first owns
      // it, and this write must miss rather than double-log the settle.
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        { nextResponseAt: at.toISOString() },
        'next_response_settled_after_breach',
        dueAtForSettle(applied.nextResponseDueAt, applied.pausedAt, at).toISOString(),
        at,
        guard,
        { unsetFields: ['nextResponseAt'] }
      )
    } else {
      const dueAt = dueAtForSettle(applied.nextResponseDueAt, applied.pausedAt, at)
      const breached = at.getTime() > dueAt.getTime()
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        breached
          ? { nextResponseAt: at.toISOString(), nextResponseBreachedAt: at.toISOString() }
          : { nextResponseAt: at.toISOString() },
        breached ? 'next_response_breached' : 'next_response_met',
        dueAt.toISOString(),
        at,
        guard,
        // See recordFirstResponse for why the breach-noted marker joins the
        // content CAS when this settle logs the breach itself.
        {
          unsetFields: breached ? ['nextResponseAt', 'nextResponseBreachedAt'] : ['nextResponseAt'],
        }
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
 * resume. Uses the shared guarded merge-write (commitStamp): the patch is
 * `pausedAt` alone, so a settle racing the pause keeps its own fields, and
 * the identity CAS on `(appliedAt, pausedAt: null)` means a concurrent
 * apply/pause/resume wins instead of getting clobbered. If the guard misses,
 * this quietly skips rather than overwriting a newer stamp. A no-op without
 * an applied SLA, when the policy opted out of pausing, or when the clock is
 * already paused (idempotent against a duplicate event).
 */
export async function pauseSlaOnSnooze(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied || applied.pauseOnSnooze === false || applied.pausedAt) return

  const landed = await commitStamp(conversationId, { pausedAt: at.toISOString() }, at, {
    appliedAt: applied.appliedAt,
    pausedAt: null,
  })
  if (!landed) return

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
  // The merge patch carries ONLY the fields resume owns: the cleared pause
  // plus the shift of each still-unsettled deadline (a settled clock's due is
  // left out of the patch entirely — it settled against whatever was live at
  // the time, and merging nothing leaves the field byte-identical).
  const patch: Partial<SlaApplied> = { pausedAt: null }
  if (applied.firstResponseDueAt && !applied.firstResponseAt) {
    patch.firstResponseDueAt = shiftIso(applied.firstResponseDueAt, shiftMs)
  }
  if (applied.nextResponseDueAt && !applied.nextResponseAt) {
    patch.nextResponseDueAt = shiftIso(applied.nextResponseDueAt, shiftMs)
  }
  if (applied.timeToCloseDueAt && !applied.resolvedAt) {
    patch.timeToCloseDueAt = shiftIso(applied.timeToCloseDueAt, shiftMs)
  }

  const landed = await commitStamp(conversationId, patch, at, {
    appliedAt: applied.appliedAt,
    pausedAt,
  })
  if (!landed) return null

  await db.insert(slaEvents).values({
    conversationId,
    policyId: applied.policyId,
    kind: 'resumed',
    meta: { pausedForSecs: Math.round(shiftMs / 1000), at: at.toISOString() },
  })
  // Reconstruct the post-write stamp (exactly what the merge produced) for a
  // caller settling right after — see this function's doc above.
  return { ...applied, ...patch }
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
