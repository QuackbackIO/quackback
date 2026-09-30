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
  inArray,
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
import { logger } from '@/lib/server/logger'
import {
  earliestHumanReplyAfter,
  latestOpenersBetween,
  responseCycles,
  responseMessagesSince,
  type ResponseCycle,
  type ResponseMessage,
} from './sla.messages'
import {
  dueAsOf,
  firstStatusSince,
  overlapMs,
  withExcludedSpans,
  type ExcludedSpan,
} from './sla.pause-history'

const log = logger.child({ component: 'sla' })

/**
 * Whether an event at `at` predates the SLA application `applied`. The SLA
 * reactions run from queued jobs that can run late or be retried after the
 * SLA was applied again (a policy change, a reopen), and an event from before
 * that belongs to the previous application: it must not settle, arm, pause or
 * close the new one. Every recorder checks this inside its CAS loop, so it
 * holds for the very stamp it then writes. A stamp without `appliedAt`
 * accepts every event. Exported for the ticket-side recorders.
 */
export function predatesApplication(
  at: Date,
  applied: { appliedAt?: string | null },
  subject: Record<string, string>
): boolean {
  if (!applied.appliedAt || at.getTime() >= new Date(applied.appliedAt).getTime()) return false
  log.debug(
    { ...subject, event_at: at.toISOString(), applied_at: applied.appliedAt },
    'SLA event predates the applied SLA, skipped'
  )
  return true
}

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
 *    recordResolution) own their clock's `*At` outcome, the settled clock's
 *    `*DueAt` (set to the deadline the settle judged against) and, when the
 *    settle itself notes the breach, that clock's `*BreachedAt`;
 *  - the pause reconcile (sla.pause-reconcile.ts), and pauseSlaOnSnooze/
 *    resumeSlaFromSnooze, own `pausedAt`, `pausedSpans`, `pauseRevision` and
 *    the pause-shift of the still-unsettled `*DueAt` deadlines;
 *  - rearmNextResponse/recordNextResponse own the next-response cycle fields
 *    (`nextResponseCycleAt`, `nextResponseDueAt`, `nextResponseAt`, and the
 *    per-cycle markers): moving to a later cycle replaces the cycle
 *    wholesale, and the merge's explicit nulls clear the old cycle's fields
 *    (jsonb-merge sets the key to null, which `->> field IS NULL` guards and
 *    falsy JS readers both treat as unset), pinned to the cycle fields it read;
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
  // When the customer message that opened the armed next-response cycle was
  // written (set with nextResponseDueAt by whoever arms the cycle). The cycle
  // is identified by it, never by comparing deadlines: a pause shift and
  // office hours make an older cycle's deadline later than a newer one's.
  // Absent on cycles armed before this field existed.
  nextResponseCycleAt?: string | null
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
  // Opened and closed by the pause reconcile (sla.pause-reconcile.ts), or by
  // pauseSlaOnSnooze / resumeSlaFromSnooze.
  pausedAt?: string | null
  // The snoozed spans already excluded from the unsettled deadlines: the
  // pause ledger the reconcile compares with the conversation's history, so a
  // span is excluded once however its reactions arrive. Absent on stamps
  // written before the ledger existed.
  pausedSpans?: ExcludedSpan[]
  // Bumped by every write to pausedAt or pausedSpans, and pinned by the
  // reconcile, so two writers of the ledger cannot both land on one read.
  pauseRevision?: number
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
    pausedSpans: [],
    pauseRevision: 0,
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
 *  claim + insert pair is atomic the same way. A next-response event names
 *  its cycle by the message that opened it (`meta.cycleAt`), so a cycle's
 *  outcome can be found and logged once (see advanceNextResponse). */
export async function insertClockEvent(
  conversationId: ConversationId,
  policyId: SlaPolicyId,
  kind: string,
  dueAt: string,
  at: Date,
  executor: StampExecutor = db,
  cycleAt?: string | null
): Promise<void> {
  const overdueMs = at.getTime() - new Date(dueAt).getTime()
  await executor.insert(slaEvents).values({
    conversationId,
    policyId,
    kind,
    meta: {
      dueAt,
      at: at.toISOString(),
      overdueSecs: Math.max(0, Math.round(overdueMs / 1000)),
      ...(cycleAt ? { cycleAt } : {}),
    },
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
  content: StampContentGuard,
  cycleAt?: string | null
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await commitStamp(conversationId, patch, at, guard, content, tx))) return false
    await insertClockEvent(conversationId, policyId, kind, dueAt, at, tx, cycleAt)
    return true
  })
}

/**
 * Record the first teammate reply against the first-response clock and log
 * met/breached. Idempotent (only the first reply counts) and a no-op when no SLA
 * is applied or the policy doesn't track first response. If the clock is
 * currently paused (snoozed under pauseOnSnooze), the elapsed pause up to `at`
 * is excluded, see dueAsOf. When the sweep already noted the breach
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
 *
 * The reaction that calls this can run after a later reply's (see
 * sla.messages.ts), so the clock settles at the first human reply written
 * since the SLA was applied, when that is earlier than `at`. It can also run
 * after a later snooze was excluded from the deadline, so the settle judges
 * the deadline as of the reply (dueAsOf) and stores that one: a settled
 * clock keeps the deadline it was judged against, whatever ran first.
 */
export async function recordFirstResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  let applied = await loadSlaApplied(conversationId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.firstResponseDueAt || applied.firstResponseAt) return
    if (predatesApplication(at, applied, { conversation_id: conversationId })) return
    // The first human reply since this SLA was applied, when it is earlier
    // than `at`: a later reply's reaction can run first.
    const settleAt = await earliestOf(
      at,
      earliestHumanReplyAfter(conversationId, new Date(applied.appliedAt))
    )
    const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
    const dueAt = dueAsOf(
      applied.firstResponseDueAt,
      applied,
      new Date(applied.appliedAt),
      settleAt
    ).toISOString()
    let committed: boolean
    if (applied.firstResponseBreachedAt) {
      // Settle-only (the breach event stays exactly-once), but log the late
      // settle itself for time-after-miss reporting. The content CAS re-checks
      // the outcome field itself: a concurrent settle that landed first owns
      // it, and this write must miss rather than double-log the settle.
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        { firstResponseAt: settleAt.toISOString(), firstResponseDueAt: dueAt },
        'first_response_settled_after_breach',
        dueAt,
        settleAt,
        guard,
        { unsetFields: ['firstResponseAt'] }
      )
    } else {
      const breached = settleAt.getTime() > new Date(dueAt).getTime()
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        breached
          ? {
              firstResponseAt: settleAt.toISOString(),
              firstResponseBreachedAt: settleAt.toISOString(),
              firstResponseDueAt: dueAt,
            }
          : { firstResponseAt: settleAt.toISOString(), firstResponseDueAt: dueAt },
        breached ? 'first_response_breached' : 'first_response_met',
        dueAt,
        settleAt,
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
 * pause up to `at` is excluded, see dueAsOf. When the sweep already
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
 *
 * A close reaction can run after a later close's, so the clock settles at the
 * first close since the SLA was applied, from the conversation's status
 * changes, when that is earlier than `at`; and, as recordFirstResponse does,
 * stores the deadline it judged against.
 */
export async function recordResolution(
  conversationId: ConversationId,
  at: Date = new Date(),
  preloaded?: SlaApplied | null
): Promise<void> {
  let applied = preloaded ?? (await loadSlaApplied(conversationId))
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.timeToCloseDueAt || applied.resolvedAt) return
    if (predatesApplication(at, applied, { conversation_id: conversationId })) return
    // The first close since this SLA was applied, when it is earlier than
    // `at`: a later close's reaction can run first.
    const settleAt = await earliestOf(
      at,
      firstStatusSince('conversation', conversationId, 'closed', new Date(applied.appliedAt))
    )
    const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
    const dueAt = dueAsOf(
      applied.timeToCloseDueAt,
      applied,
      new Date(applied.appliedAt),
      settleAt
    ).toISOString()
    let committed: boolean
    if (applied.resolutionBreachedAt) {
      // Settle-only (the breach event stays exactly-once), but log the late
      // settle itself for time-after-miss reporting. The content CAS re-checks
      // the outcome field itself: a concurrent settle that landed first owns
      // it, and this write must miss rather than double-log the settle.
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        { resolvedAt: settleAt.toISOString(), timeToCloseDueAt: dueAt },
        'resolution_settled_after_breach',
        dueAt,
        settleAt,
        guard,
        { unsetFields: ['resolvedAt'] }
      )
    } else {
      const breached = settleAt.getTime() > new Date(dueAt).getTime()
      committed = await commitClockEvent(
        conversationId,
        applied.policyId,
        breached
          ? {
              resolvedAt: settleAt.toISOString(),
              resolutionBreachedAt: settleAt.toISOString(),
              timeToCloseDueAt: dueAt,
            }
          : { resolvedAt: settleAt.toISOString(), timeToCloseDueAt: dueAt },
        breached ? 'resolution_breached' : 'resolution_met',
        dueAt,
        settleAt,
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
 * Keep the next-response clock in line with the conversation's messages. The
 * SLA reaction calls this on a customer message (rearmNextResponse) and on a
 * teammate reply (recordNextResponse), from a queued job that can run late,
 * out of order, retried or twice, so it never goes by the order the calls
 * arrive in. The cycles come from the message rows (see sla.messages.ts's
 * responseCycles): after the first response, each customer message restarts
 * the wait, and the next human reply answers the latest one. The first
 * response is the one the stamp records, else the first human reply since the
 * SLA was applied. A caller's own message, and the cycle and reply the stamp
 * already records, count too, for a caller whose message has no row.
 *
 * The stamp carries the latest cycle: armed with its office-hours deadline
 * from the message that opened it (`nextResponseCycleAt`), plus every snoozed
 * span the stamp has already excluded since, and settled at its reply once
 * that is written, judged as of the reply (dueAsOf), logged met or breached.
 * A cycle that a later message replaced on the stamp before its reply's
 * reaction ran still gets its outcome logged, once, in the write that moves
 * the stamp past it. When the sweep already noted the armed cycle's breach,
 * its reply only settles it and logs `next_response_settled_after_breach`
 * with the lag (meta.overdueSecs).
 *
 * A no-op when no SLA is applied, when the policy does not track next
 * response, or does not track first response: the very first customer wait is
 * the first-response clock's alone. The deadline math runs on the stamp's own
 * scheduleSnapshot (see SlaApplied), never the live policy; stamps written
 * before the snapshot existed fall back to resolving the live policy's
 * schedule. Every write pins the cycle fields and the pause ledger it read,
 * so a concurrent writer makes it miss, reload and decide again.
 *
 * The rows are read from the armed cycle's opener on once the stamp records
 * the first response (see cycleReadFrom), so a reaction reads the messages of
 * the current cycle, not the conversation's whole history. A cycle an earlier
 * build armed without recording its opener is adopted first (adoptArmedCycle).
 */
export async function rearmNextResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  await syncNextResponse(conversationId, { at, kind: 'opener' })
}

/** See rearmNextResponse: the same reconcile, on a teammate reply written at `at`. */
export async function recordNextResponse(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<void> {
  await syncNextResponse(conversationId, { at, kind: 'reply' })
}

async function syncNextResponse(
  conversationId: ConversationId,
  own: ResponseMessage
): Promise<void> {
  let applied = await loadSlaApplied(conversationId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || !applied.nextResponseTargetSecs || !applied.firstResponseDueAt) return
    if (predatesApplication(own.at, applied, { conversation_id: conversationId })) return
    if (applied.nextResponseDueAt && !applied.nextResponseCycleAt) {
      const adopted = await adoptArmedCycle(conversationId, applied, own.at)
      if (adopted === 'missed') {
        applied = await loadSlaApplied(conversationId)
        continue
      }
      if (adopted) applied = adopted
    }
    const cycles = responseCycles(
      await knownResponseMessages(conversationId, applied, own),
      new Date(applied.appliedAt),
      applied.firstResponseAt ? new Date(applied.firstResponseAt) : null
    )
    const latest = cycles[cycles.length - 1]
    if (!latest) return
    const armed = cycleStart(applied)?.getTime() ?? null
    let committed: boolean
    if (armed === latest.opener.getTime()) {
      // The stamp carries the latest cycle: settle it once its reply is written.
      if (!latest.reply || applied.nextResponseAt) return
      committed = await settleNextResponse(conversationId, applied, latest.reply)
    } else {
      // A cycle armed from a later message than the rows show stands.
      if (armed !== null && armed > latest.opener.getTime()) return
      const schedule = applied.scheduleSnapshot ?? (await legacyScheduleFor(applied.policyId))
      if (!schedule) return
      committed = await advanceNextResponse(conversationId, applied, schedule, cycles, own.at)
    }
    if (committed) return
    applied = await loadSlaApplied(conversationId)
  }
}

/**
 * The conversation's replies and cycle openers since the SLA was applied, plus
 * the caller's own message and the cycle opener and reply the stamp records,
 * where no row was written at that time.
 */
async function knownResponseMessages(
  conversationId: ConversationId,
  applied: SlaApplied,
  own: ResponseMessage
): Promise<ResponseMessage[]> {
  const rows = await responseMessagesSince(conversationId, cycleReadFrom(applied))
  const recorded: ResponseMessage[] = [own]
  if (applied.nextResponseCycleAt) {
    recorded.push({ at: new Date(applied.nextResponseCycleAt), kind: 'opener' })
  }
  if (applied.nextResponseAt) {
    recorded.push({ at: new Date(applied.nextResponseAt), kind: 'reply' })
  }
  const written = new Set(rows.map((row) => row.at.getTime()))
  return [...rows, ...recorded.filter((message) => !written.has(message.at.getTime()))]
}

/**
 * Where the message rows the cycles need begin. Until the stamp records the
 * first response, the cycles start after the first reply in the rows, so the
 * rows are read from the application. Once it does, from the armed cycle's
 * opener, else the first response: outcomes are logged only from the armed
 * cycle on, the stamp never moves back to an earlier cycle, and no row at or
 * before the first response opens one, so every cycle the reconcile acts on is
 * built from the same rows a read from the application returns. A caller's own
 * message from before this point is still counted (knownResponseMessages), and
 * a later opener supersedes it.
 */
function cycleReadFrom(applied: SlaApplied): Date {
  if (!applied.firstResponseAt) return new Date(applied.appliedAt)
  const bounds = [applied.appliedAt, applied.firstResponseAt, applied.nextResponseCycleAt]
    .filter((at): at is string => Boolean(at))
    .map((at) => new Date(at).getTime())
  return new Date(Math.max(...bounds))
}

/** How many openers the adoption of an earlier build's cycle looks back through. */
const ADOPTION_CANDIDATES = 20

/**
 * A stamp an earlier build armed records its cycle's deadline, and its reply
 * once answered, but not the message that opened it. Adopt that cycle once, so
 * the stamp then behaves as one this build armed: a reply to it settles it
 * (after a sweep breach, as a settle after the breach), and the rows are read
 * from it on. The opener is the latest cycle opener after the first response,
 * written before the message this reaction is for and before the cycle's
 * reply (or at or before its deadline), whose own office-hours deadline is no
 * later than the stamp's. The earlier build reacted to every message before
 * the first one this build reacts to, and armed the cycle from its opener's
 * time; a pause only ever moved that deadline later. The reacting message is
 * left out because, with office hours, it can give the same deadline.
 *
 * Written alone, pinned to the cycle fields read. Returns the adopted stamp,
 * null when there is nothing to adopt, or 'missed' when a concurrent write
 * moved the cycle first.
 */
async function adoptArmedCycle(
  conversationId: ConversationId,
  applied: SlaApplied,
  reactingAt: Date
): Promise<SlaApplied | null | 'missed'> {
  const due = applied.nextResponseDueAt
  if (!due || !applied.firstResponseAt || !applied.nextResponseTargetSecs) return null
  const schedule = applied.scheduleSnapshot ?? (await legacyScheduleFor(applied.policyId))
  if (!schedule) return null
  const before = Math.min(
    reactingAt.getTime(),
    applied.nextResponseAt ? Date.parse(applied.nextResponseAt) : Date.parse(due) + 1
  )
  const candidates = await latestOpenersBetween(
    conversationId,
    new Date(Math.max(Date.parse(applied.firstResponseAt), Date.parse(applied.appliedAt))),
    new Date(before),
    ADOPTION_CANDIDATES
  )
  const target = applied.nextResponseTargetSecs
  const opener = candidates.find(
    (candidate) =>
      addOfficeHoursSeconds(schedule, candidate, target).getTime() <= new Date(due).getTime()
  )
  if (!opener) return null
  const patch = { nextResponseCycleAt: opener.toISOString() }
  const landed = await commitStamp(
    conversationId,
    patch,
    reactingAt,
    { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null },
    {
      pinnedFields: {
        nextResponseCycleAt: null,
        nextResponseDueAt: due,
        nextResponseAt: applied.nextResponseAt ?? null,
      },
    }
  )
  return landed ? { ...applied, ...patch } : 'missed'
}

/** When the armed next-response cycle opened, when the stamp records it. */
function cycleStart(applied: SlaApplied): Date | null {
  return applied.nextResponseCycleAt ? new Date(applied.nextResponseCycleAt) : null
}

/**
 * Move the stamp from its armed cycle (or none) to the latest cycle in
 * `cycles`, settled at its reply when one is written, and log the outcome of
 * every answered cycle from the armed one on that the log does not hold yet.
 * A cycle's deadline is its opener's office-hours deadline plus the snoozed
 * spans the stamp has excluded since, judged as of its reply. The stamp write
 * and the events share one transaction, pinned to the cycle fields and the
 * pause ledger read, so a cycle's outcome is logged once.
 */
async function advanceNextResponse(
  conversationId: ConversationId,
  applied: SlaApplied,
  schedule: EngineSchedule,
  cycles: ResponseCycle[],
  at: Date
): Promise<boolean> {
  const target = applied.nextResponseTargetSecs as number
  const judge = (cycle: ResponseCycle) => {
    const stored = withExcludedSpans(
      addOfficeHoursSeconds(schedule, cycle.opener, target),
      applied,
      cycle.opener
    )
    if (!cycle.reply) return { dueAt: stored, breached: false }
    const dueAt = dueAsOf(stored.toISOString(), applied, cycle.opener, cycle.reply)
    return { dueAt, breached: cycle.reply.getTime() > dueAt.getTime() }
  }
  const armed = cycleStart(applied)?.getTime() ?? Number.NEGATIVE_INFINITY
  const logged = await loggedCycleOutcomes(conversationId, armed)
  const named = new Set(logged.flatMap((event) => (event.cycleAt === null ? [] : [event.cycleAt])))
  // Outcomes logged before cycles were named, matched to a cycle by their time.
  const unnamed = logged
    .flatMap((event) => (event.cycleAt === null ? [event.at] : []))
    .sort((a, b) => a - b)
  const unnamedWithin = (from: number, until: number) => {
    let low = 0
    let high = unnamed.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (unnamed[mid] < from) low = mid + 1
      else high = mid
    }
    return low < unnamed.length && unnamed[low] < until
  }
  const outcomes = cycles.filter(
    (cycle, index) =>
      cycle.reply !== null &&
      cycle.opener.getTime() >= armed &&
      !named.has(cycle.opener.getTime()) &&
      !unnamedWithin(
        cycle.opener.getTime(),
        cycles[index + 1]?.opener.getTime() ?? Number.POSITIVE_INFINITY
      )
  )
  const latest = cycles[cycles.length - 1]
  const settled = judge(latest)
  const patch: Partial<SlaApplied> = {
    nextResponseCycleAt: latest.opener.toISOString(),
    nextResponseDueAt: settled.dueAt.toISOString(),
    nextResponseAt: latest.reply?.toISOString() ?? null,
    nextResponseBreachedAt: latest.reply && settled.breached ? latest.reply.toISOString() : null,
    nextResponseWarningFiredAt: null,
    nextResponseBreachTriggerFiredAt: null,
  }
  const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
  const content: StampContentGuard = {
    pinnedFields: {
      nextResponseDueAt: applied.nextResponseDueAt ?? null,
      nextResponseAt: applied.nextResponseAt ?? null,
      nextResponseCycleAt: applied.nextResponseCycleAt ?? null,
      pauseRevision: revisionPin(applied),
    },
  }
  return db.transaction(async (tx) => {
    if (!(await commitStamp(conversationId, patch, at, guard, content, tx))) return false
    for (const cycle of outcomes) {
      const { dueAt, breached } = judge(cycle)
      await insertClockEvent(
        conversationId,
        applied.policyId,
        breached ? 'next_response_breached' : 'next_response_met',
        dueAt.toISOString(),
        cycle.reply as Date,
        tx,
        cycle.opener.toISOString()
      )
    }
    return true
  })
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

/** The earlier of `at` and the time `other` resolves to, when it resolves to one. */
async function earliestOf(at: Date, other: Promise<Date | null>): Promise<Date> {
  const time = await other
  return time && time.getTime() < at.getTime() ? time : at
}

const NEXT_RESPONSE_OUTCOMES = [
  'next_response_met',
  'next_response_breached',
  'next_response_settled_after_breach',
]

/**
 * The next-response outcomes logged for the conversation: the cycle each
 * names (by its opener), or, for one logged before cycles were named, its time.
 */
async function loggedCycleOutcomes(
  conversationId: ConversationId,
  from: number
): Promise<{ cycleAt: number | null; at: number }[]> {
  // Only outcomes that can match a cycle from `from` on: one naming such a
  // cycle, or an untagged one logged within one (its time is at or after the
  // cycle's opener). ISO instants compare in time order as text.
  const since = Number.isFinite(from)
    ? [
        sql`coalesce(${slaEvents.meta} ->> 'cycleAt', ${slaEvents.meta} ->> 'at') >= ${new Date(from).toISOString()}`,
      ]
    : []
  const rows = await db
    .select({ meta: slaEvents.meta })
    .from(slaEvents)
    .where(
      and(
        eq(slaEvents.conversationId, conversationId),
        inArray(slaEvents.kind, NEXT_RESPONSE_OUTCOMES),
        ...since
      )
    )
  return rows.map(({ meta }) => {
    const { cycleAt, at } = meta as { cycleAt?: string; at?: string }
    return {
      cycleAt: cycleAt ? new Date(cycleAt).getTime() : null,
      at: at ? new Date(at).getTime() : Number.NaN,
    }
  })
}

/**
 * Settle the armed next-response cycle at its reply `at` and log met/breached
 * (or the settle after a breach the sweep already noted). The stored deadline
 * becomes the one the settle judged against. Pinned to the deadline it read,
 * so a re-arm or a pause shift landing in between makes it miss rather than
 * settle against a stale deadline.
 */
async function settleNextResponse(
  conversationId: ConversationId,
  applied: SlaApplied,
  at: Date
): Promise<boolean> {
  if (!applied.nextResponseDueAt) return false
  const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
  const pinnedFields = { nextResponseDueAt: applied.nextResponseDueAt }
  const dueAt = dueAsOf(applied.nextResponseDueAt, applied, cycleStart(applied), at).toISOString()
  if (applied.nextResponseBreachedAt) {
    // Settle-only (the breach event stays exactly-once), but log the late
    // settle itself for time-after-miss reporting. The content CAS re-checks
    // the outcome field itself: a concurrent settle that landed first owns
    // it, and this write must miss rather than double-log the settle.
    return commitClockEvent(
      conversationId,
      applied.policyId,
      { nextResponseAt: at.toISOString(), nextResponseDueAt: dueAt },
      'next_response_settled_after_breach',
      dueAt,
      at,
      guard,
      { unsetFields: ['nextResponseAt'], pinnedFields },
      applied.nextResponseCycleAt
    )
  }
  const breached = at.getTime() > new Date(dueAt).getTime()
  return commitClockEvent(
    conversationId,
    applied.policyId,
    breached
      ? {
          nextResponseAt: at.toISOString(),
          nextResponseBreachedAt: at.toISOString(),
          nextResponseDueAt: dueAt,
        }
      : { nextResponseAt: at.toISOString(), nextResponseDueAt: dueAt },
    breached ? 'next_response_breached' : 'next_response_met',
    dueAt,
    at,
    guard,
    // See recordFirstResponse for why the breach-noted marker joins the
    // content CAS when this settle logs the breach itself.
    {
      unsetFields: breached ? ['nextResponseAt', 'nextResponseBreachedAt'] : ['nextResponseAt'],
      pinnedFields,
    },
    applied.nextResponseCycleAt
  )
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
  if (predatesApplication(at, applied, { conversation_id: conversationId })) return

  const landed = await commitStamp(
    conversationId,
    { pausedAt: at.toISOString(), pauseRevision: (applied.pauseRevision ?? 0) + 1 },
    at,
    { appliedAt: applied.appliedAt, pausedAt: null },
    { pinnedFields: { pauseRevision: revisionPin(applied) } }
  )
  if (!landed) return

  await db.insert(slaEvents).values({
    conversationId,
    policyId: applied.policyId,
    kind: 'paused',
    meta: { at: at.toISOString() },
  })
}

/** The pause-ledger revision a writer pins (see SlaApplied.pauseRevision). */
function revisionPin(applied: { pauseRevision?: number }): string | null {
  return applied.pauseRevision === undefined ? null : String(applied.pauseRevision)
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
 *
 * A resume never ends a pause that began after `at`: the reaction that calls
 * this runs from a queued job that can run late, after the conversation was
 * snoozed again, and that later pause stands.
 */
export async function resumeSlaFromSnooze(
  conversationId: ConversationId,
  at: Date = new Date()
): Promise<SlaApplied | null> {
  const applied = await loadSlaApplied(conversationId)
  if (!applied || !applied.pausedAt) return null
  if (new Date(applied.pausedAt).getTime() > at.getTime()) return null

  const pausedAt = applied.pausedAt
  const shiftMs = Math.max(0, at.getTime() - new Date(pausedAt).getTime())
  // The merge patch carries ONLY the fields resume owns: the cleared pause,
  // the span added to the ledger, plus the shift of each still-unsettled
  // deadline (a settled clock's due is left out of the patch entirely: it
  // settled against whatever was live at the time, and merging nothing leaves
  // the field byte-identical). An armed next-response cycle shifts only by the
  // part of the pause after it opened.
  const patch: Partial<SlaApplied> = {
    pausedAt: null,
    pausedSpans: [...(applied.pausedSpans ?? []), { from: pausedAt, until: at.toISOString() }],
    pauseRevision: (applied.pauseRevision ?? 0) + 1,
  }
  if (applied.firstResponseDueAt && !applied.firstResponseAt) {
    patch.firstResponseDueAt = shiftIso(applied.firstResponseDueAt, shiftMs)
  }
  if (applied.nextResponseDueAt && !applied.nextResponseAt) {
    const cycleFrom = cycleStart(applied)?.getTime() ?? Number.NEGATIVE_INFINITY
    patch.nextResponseDueAt = shiftIso(
      applied.nextResponseDueAt,
      overlapMs(new Date(pausedAt).getTime(), at.getTime(), cycleFrom, at.getTime())
    )
  }
  if (applied.timeToCloseDueAt && !applied.resolvedAt) {
    patch.timeToCloseDueAt = shiftIso(applied.timeToCloseDueAt, shiftMs)
  }

  const landed = await commitStamp(
    conversationId,
    patch,
    at,
    { appliedAt: applied.appliedAt, pausedAt },
    { pinnedFields: { pauseRevision: revisionPin(applied) } }
  )
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
