/**
 * Conversation SLA sweeps (support platform §4.6) — the scan/claim twins of
 * sla.service.ts's lazy recorders, split out of that module to keep both under
 * the domain max-lines budget (the same split ticket-sla.service.ts /
 * ticket-sla.sweep.ts keep on the ticket axis). All three passes keep the
 * domain's invariants (see sla.service.ts's docs): SQL only narrows the scan,
 * the recording/claiming rule lives in JS, and every stamp write is the shared
 * guarded jsonb-merge (commitStamp) every other stamp writer uses, so a lazy
 * settle, a pause/resume, or a re-apply racing a sweep can never produce a
 * duplicate event or clobber a newer stamp.
 *
 * Wiring + claim ordering:
 *  - sweepOverdueSlaBreaches rides the per-minute sla-breach-sweep-queue tick
 *    (the REPORTING axis): it claims each breach-noted marker and appends the
 *    sla_events row, atomically in one transaction — see its own doc.
 *  - sweepApproachingSlaBreaches / sweepSlaBreachTriggers ride
 *    workflow-sweep.ts's 5-minute sweepSlaTimerTriggers (the workflow-TRIGGER
 *    axis): they scan candidates WITHOUT claiming, and the fire-once marker
 *    is claimed by the caller only AFTER the candidate's dispatch was
 *    successfully enqueued (claim-after-enqueue — see
 *    claimSlaTimerTriggerMarker's doc for why the order is enqueue-then-claim
 *    and not the reverse).
 */
import { db, and, isNotNull, sql, conversations } from '@/lib/server/db'
import type { ConversationId, SlaPolicyId } from '@quackback/ids'
import type { EventConversationRef } from '@/lib/server/events/types'
import { commitStamp, insertClockEvent, type SlaApplied, type StampExecutor } from './sla.service'

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

/** A row scanSlaClockCandidates selects: the SLA stamp plus the
 *  EventConversationRef fields the two timer-trigger sweeps need to build
 *  each candidate's `conversation` ref (webhook payload parity). */
interface SlaSweepRow {
  id: ConversationId
  slaApplied: unknown
  status: string
  channel: string
  priority: string
  assignedTeamId: string | null
}

/** Build the EventConversationRef every sibling conversation event embeds,
 *  from a scan row. */
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
 * The generic scan skeleton shared by every SLA sweep pass below: fetch every
 * conversation with an active (non-paused) SLA whose stamp satisfies
 * `buildWindowSql` (batched at SWEEP_BATCH_LIMIT), then for each of
 * SLA_CLOCKS' three clocks on each row, re-check `isEligible` in JS (SQL only
 * narrows the scan; the recording/claiming rule always lives in JS, per every
 * sweep in this domain) and hand the candidate to `visit`. The skeleton
 * itself never writes: claiming is each pass's own choice (the reporting
 * sweep claims + inserts atomically inside its visit; the trigger sweeps
 * leave the claim to their caller — see this module's doc for the
 * claim-after-enqueue ordering).
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
async function scanSlaClockCandidates(
  at: Date,
  buildWindowSql: (nowIso: string) => ReturnType<typeof sql>,
  isEligible: (clock: SlaClock, applied: SlaApplied, dueAt: string) => boolean,
  visit: (row: SlaSweepRow, applied: SlaApplied, clock: SlaClock, dueAt: string) => Promise<void>
): Promise<void> {
  const nowIso = at.toISOString() // ISO-8601 compares lexicographically = chronologically
  const rows = await db
    .select({
      id: conversations.id,
      slaApplied: conversations.slaApplied,
      // Only the timer-trigger sweeps actually use these (to build each
      // candidate's EventConversationRef — support platform §4.6, webhook
      // payload parity); sweepOverdueSlaBreaches ignores them. Selected
      // unconditionally rather than threading a second query shape through
      // this shared skeleton for one caller.
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
      await visit(row, applied, clock, dueAt)
    }
  }
}

/**
 * Claim `markerField` on a scanned clock via the shared guarded merge-write
 * (commitStamp), with the claim's canonical guard shape so the call sites
 * can't drift:
 *
 *  - identity CAS on `(appliedAt, pausedAt: null)` — the stamp must still be
 *    the exact un-paused application the scan read (a pause/resume or
 *    re-apply between scan and claim wins instead);
 *  - the due date PINNED to the scanned one — a pause+resume cycle between
 *    scan and claim keeps pausedAt null but shifts the deadline, which would
 *    otherwise claim against a deadline that no longer exists;
 *  - the marker itself still unset — the fire-once/record-once CAS: a sibling
 *    tick or the lazy evaluator that claimed it first wins;
 *  - the clock's `settledField` still unset — EVERY claim re-checks it (A2,
 *    not just the reporting sweep's): a settle landing between scan and claim
 *    doesn't change `appliedAt`/`pausedAt`, so the identity CAS alone
 *    wouldn't catch it, and the claim must miss rather than mark a clock that
 *    already resolved itself.
 */
async function claimSlaClockMarker(
  conversationId: ConversationId,
  appliedAt: string,
  clock: SlaClock,
  markerField: keyof SlaApplied,
  dueAt: string,
  at: Date,
  executor: StampExecutor = db
): Promise<boolean> {
  return commitStamp(
    conversationId,
    { [markerField]: at.toISOString() },
    at,
    { appliedAt, pausedAt: null },
    {
      unsetFields: [markerField, clock.settledField],
      pinnedFields: { [clock.dueField]: dueAt },
    },
    executor
  )
}

/**
 * The breach sweep (run every minute by sla-breach-sweep-queue): find
 * conversations whose stamped first-response / next-response / time-to-close
 * deadline has passed with no settle and no breach noted yet, and record the
 * breach.
 *
 * Exactly-once + atomic: each breach is CLAIMED and its event INSERTED in one
 * transaction. The claim is the guarded merge-write above — so a lazy
 * evaluation (agent reply / close), a pause, or a re-apply racing the sweep
 * across its wide scan-to-write span loses the CAS and can't produce a
 * duplicate event — and the transaction means the marker and its event land
 * together or not at all (a failure between them would otherwise leave a
 * claimed marker with no event: the breach silently lost from the log while
 * the stamp suppresses every later attempt).
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
  await scanSlaClockCandidates(
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
    async (row, applied, clock, dueAt) => {
      await db.transaction(async (tx) => {
        const landed = await claimSlaClockMarker(
          row.id,
          applied.appliedAt,
          clock,
          clock.breachedField,
          dueAt,
          at,
          tx
        )
        if (!landed) return // settled, paused, re-applied, or claimed meanwhile
        await insertClockEvent(row.id, applied.policyId, clock.reportKind, dueAt, at, tx)
        recorded++
      })
    }
  )
  return { recorded }
}

// ---------------------------------------------------------------------------
// Timer-driven workflow triggers (support platform §4.6): sla.approaching_breach
// / sla.breached. Both are scanned from workflow-sweep.ts's 5-minute tick (NOT
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

/** One (conversation, clock) pair a timer-trigger scan found eligible and
 *  which workflow-sweep.ts turns into a dispatchSlaApproachingBreach /
 *  dispatchSlaBreached call. The candidate is scanned WITHOUT its fire-once
 *  marker claimed (claim-after-enqueue — see claimSlaTimerTriggerMarker), so
 *  it carries everything the post-enqueue claim's CAS re-verifies:
 *  `appliedAt` pins the stamp identity and `dueAt` pins the deadline it
 *  computed from. */
export interface SlaTimerTriggerCandidate {
  conversationId: ConversationId
  conversation: EventConversationRef
  policyId: SlaPolicyId
  clock: 'first_response' | 'next_response' | 'resolution'
  dueAt: string
  appliedAt: string
}

/**
 * Claim the fire-once marker for a scanned timer-trigger candidate — called
 * by workflow-sweep.ts ONLY after the candidate's dispatch enqueue succeeded
 * (claim-after-enqueue). The ordering is the whole point: under the old
 * claim-then-dispatch order a dispatch failure (queue down, transient error)
 * lost the trigger forever, because the claimed marker suppressed every later
 * retry. Scanning unclaimed + enqueueing first means an enqueue failure
 * leaves the marker unset, so the next tick re-scans and retries; and a
 * successful enqueue followed by a missed claim only ever means a sibling
 * tick claimed first (its enqueue hit the same deterministic BullMQ jobId and
 * was deduped — one job, one marker, no double dispatch).
 *
 * The claim's CAS re-checks the clock's `settledField` (see
 * claimSlaClockMarker): a settle landing between scan and claim keeps the
 * marker unstamped — the stamp then truthfully records that this trigger
 * never fired for the settled cycle, and a later re-arm/apply starts clean.
 */
export async function claimSlaTimerTriggerMarker(
  candidate: Pick<SlaTimerTriggerCandidate, 'conversationId' | 'clock' | 'dueAt' | 'appliedAt'>,
  marker: 'warning' | 'breach',
  at: Date
): Promise<boolean> {
  const clock = SLA_CLOCKS.find((c) => c.clock === candidate.clock)
  if (!clock) return false
  return claimSlaClockMarker(
    candidate.conversationId,
    candidate.appliedAt,
    clock,
    marker === 'warning' ? clock.warningMarkerField : clock.breachMarkerField,
    candidate.dueAt,
    at
  )
}

/**
 * Scan for conversations whose unsettled clock enters the approaching-breach
 * lead window (`due - leadMinutes <= now < due`) and return each as an
 * unclaimed candidate (claim-after-enqueue — see claimSlaTimerTriggerMarker;
 * the `*WarningFiredAt` marker itself is claimed by the caller post-enqueue).
 * Pause-aware the same way sweepOverdueSlaBreaches is: a currently-paused
 * clock never approaches (excluded in SQL and re-checked in JS). Already-due
 * clocks are excluded too — those are sla.breached's job below, not a warning.
 * Returns the candidates for the caller (workflow-sweep.ts) to dispatch.
 */
export async function sweepApproachingSlaBreaches(
  leadMinutes: number,
  at: Date = new Date()
): Promise<SlaTimerTriggerCandidate[]> {
  const horizon = new Date(at.getTime() + leadMinutes * 60_000).toISOString()
  const candidates: SlaTimerTriggerCandidate[] = []
  await scanSlaClockCandidates(
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
    async (row, applied, clock, dueAt) => {
      candidates.push({
        conversationId: row.id,
        conversation: conversationRefFromRow(row),
        policyId: applied.policyId,
        clock: clock.clock,
        dueAt,
        appliedAt: applied.appliedAt,
      })
    }
  )
  return candidates
}

/**
 * Scan for conversations whose unsettled clock has passed its due date and
 * return each as an unclaimed candidate (claim-after-enqueue — see
 * claimSlaTimerTriggerMarker; the `*BreachTriggerFiredAt` marker is claimed
 * by the caller post-enqueue). The breach-trigger marker is independent of
 * (and in addition to) sweepOverdueSlaBreaches's own `*BreachedAt` claim
 * above: different marker field, so whichever of the per-minute reporting
 * sweep or this 5-minute trigger sweep runs first never blocks the other. No
 * lead time: this fires the instant `now >= due`, same as
 * sweepOverdueSlaBreaches's own breach detection. Returns the candidates for
 * the caller (workflow-sweep.ts) to dispatch.
 */
export async function sweepSlaBreachTriggers(
  at: Date = new Date()
): Promise<SlaTimerTriggerCandidate[]> {
  const candidates: SlaTimerTriggerCandidate[] = []
  await scanSlaClockCandidates(
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
    async (row, applied, clock, dueAt) => {
      candidates.push({
        conversationId: row.id,
        conversation: conversationRefFromRow(row),
        policyId: applied.policyId,
        clock: clock.clock,
        dueAt,
        appliedAt: applied.appliedAt,
      })
    }
  )
  return candidates
}
