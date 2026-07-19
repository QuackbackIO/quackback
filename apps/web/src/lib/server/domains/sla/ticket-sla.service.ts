/**
 * Ticket-anchored SLA — the time-to-resolve (TTR) clock (support platform
 * §4.6). SLAs live on conversations AND tickets with DISJOINT targets: the
 * conversation stamp (sla.service.ts) carries FRT/NRT/TTC, while the ticket
 * stamp here carries TTR only — seconds from application to the ticket
 * reaching a 'closed'-category status. A ticket's stamp lives on
 * `tickets.sla_applied` and its timeline rides the same append-only
 * `sla_events` log as conversation clocks, with `ticket_id` set and
 * `conversation_id` NULL (a back-office ticket has no conversation, and even
 * a conversation-linked ticket's TTR is a fact about the TICKET, so the event
 * subject stays the ticket either way).
 *
 * Application is never ambient, mirroring the conversation side: the Apply-SLA
 * workflow action with `target: 'ticket'` calls applySlaToTicket directly, and
 * the create-ticket link flow (ticket-conversation-link.service.ts) hands off
 * the conversation's active policy when a customer ticket is linked to an
 * SLA'd conversation ("applied first time" semantics). TRACKER tickets are
 * excluded outright — a tracker umbrellas other tickets and has no resolution
 * clock of its own.
 *
 * The pause signal mirrors pauseOnSnooze with a different axis: a policy
 * opted into `pauseOnPending` stops the TTR clock while the ticket sits in a
 * 'pending'-CATEGORY status (waiting on the customer / a third party), and
 * resume shifts the still-unsettled deadline forward by the paused span — the
 * same math as the conversation's snooze pause, reused via the helpers
 * sla.service.ts exports. The status transitions arrive off the event bus
 * (sla.event-hooks.ts's ticket.status_changed case); deadlines that pass with
 * NO further event are caught by the sweep twins in ticket-sla.sweep.ts,
 * wired into the same per-minute (sla-breach-sweep-queue.ts) and 5-minute
 * (workflow-sweep.ts) ticks as the conversation sweeps.
 *
 * One settlement rule differs deliberately from the conversation's
 * time-to-close: the FIRST resolution settles TTR permanently. A reopen does
 * NOT re-arm the clock (the stamp's resolvedAt is never cleared), so a
 * reopened ticket can't breach again or re-report — reopenedCount on the
 * ticket row stays the quality signal for reopen churn, matching Intercom's
 * "time to resolution is measured to first close" semantics.
 */
import { db, and, eq, isNull, sql, tickets, ticketStatuses, slaEvents } from '@/lib/server/db'
import type { SlaPolicyId, TicketId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { getSlaPolicy } from './sla-policy.service'
import { resolveScheduleFor, dueAtForSettle, shiftIso, type StampExecutor } from './sla.service'
import { addOfficeHoursSeconds, type EngineSchedule } from '../office-hours/office-hours.service'

/**
 * The `tickets.sla_applied` shape: the one active SLA on a ticket, carrying
 * the TTR clock only. A `type` (not `interface`) so it stays assignable to the
 * column's `Record<string, unknown>` json type. Field vocabulary deliberately
 * mirrors the conversation stamp (`resolvedAt`, `resolutionBreachedAt`, ...)
 * so the sweep/CAS machinery reads the same on both axes — and so the
 * `tickets_sla_unsettled_idx` partial index (migration 0212) can predicate on
 * `resolvedAt` with the same semantics the conversation index relies on.
 *
 * FIELD OWNERSHIP: identical contract to the conversation stamp (see
 * SlaApplied's ownership map on sla.service.ts) — every writer merges ONLY
 * the fields it owns via commitTicketStamp's jsonb `||`, guarded by the
 * identity CAS plus content predicates, never rewriting the whole stamp:
 * recordTicketResolution owns `resolvedAt` (and `resolutionBreachedAt` when
 * the settle itself notes the breach), pause/resume own `pausedAt` + the
 * deadline's pause-shift, and the sweeps own the `*BreachedAt` /
 * `*WarningFiredAt` / `*BreachTriggerFiredAt` markers.
 */
export type TicketSlaApplied = {
  policyId: SlaPolicyId
  // Snapshot for display without a join back to the (possibly edited/deleted) policy.
  policyName: string
  appliedAt: string // ISO
  // The office-hours schedule the TTR clock ran on, snapshotted at apply time
  // (the resolved engine shape — see SlaApplied.scheduleSnapshot's doc, the
  // same snapshot contract). Nothing on the ticket axis re-derives a deadline
  // from the schedule today (the resume shift is a plain wall-clock delta);
  // the snapshot is stamped for the same contract the conversation side
  // keeps, so any future re-arm-style writer never needs the live policy.
  scheduleSnapshot?: EngineSchedule | null
  // Absolute, office-hours-aware deadline. Always set on a live stamp:
  // applySlaToTicket refuses to stamp a policy that doesn't track TTR, so a
  // stamp's existence means the clock is armed.
  timeToResolveDueAt: string
  // Lazy-eval outcome: when the ticket first reached a 'closed'-category
  // status, or null/absent while the clock is still open. NEVER cleared once
  // set — the first resolution settles TTR permanently; a later reopen leaves
  // this in place, so the clock can't re-arm, re-breach, or re-report.
  resolvedAt?: string | null
  // Breach-noted marker: set the moment a breach event is logged (by the
  // sweep or the lazy evaluator), so repeated sweeps and a late settle stay
  // exactly-once on the sla_events log. Unset on old stamps = not yet noted.
  resolutionBreachedAt?: string | null
  // Timer-driven workflow-trigger fire markers (support platform §4.6) —
  // DISTINCT from the breach-noted marker above, which exists purely to keep
  // the sla_events reporting log exactly-once. These two exist only so
  // sweepApproachingTicketSlaBreaches / sweepTicketSlaBreachTriggers (below)
  // fire sla.approaching_breach / sla.breached at most once per ticket SLA
  // application. CAS-guarded the same way as the breach-noted marker, cleared
  // implicitly on a fresh apply (a new `appliedAt` reads every marker as
  // absent again).
  resolutionWarningFiredAt?: string | null
  resolutionBreachTriggerFiredAt?: string | null
  // Snapshot of the policy's pause rule so the inbox chip can show a paused
  // state without a join back to the policy. Absent on stamps written before
  // this field existed reads as true (the policy default).
  pauseOnPending?: boolean
  // ISO instant the clock was paused at (the ticket entered a
  // 'pending'-category status under a pauseOnPending policy). Absent/null
  // while the clock is running. Set by pauseTicketSlaOnPending, cleared by
  // resumeTicketSlaFromPending once the still-unsettled deadline has been
  // shifted forward by the paused span.
  pausedAt?: string | null
}

/** The active SLA stamped on a ticket, or null when none is applied. */
async function loadTicketSlaApplied(ticketId: TicketId): Promise<TicketSlaApplied | null> {
  const [row] = await db
    .select({ slaApplied: tickets.slaApplied })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1)
  return (row?.slaApplied as TicketSlaApplied | undefined) ?? null
}

/**
 * The identity half of the CAS guard shared by every writer of
 * `tickets.sla_applied` (pause/resume/settle/sweep claims, all via
 * commitTicketStamp): the update only lands while the stamp is still the
 * exact one the caller read from — `appliedAt` identifies which SLA
 * application it is, `pausedAt` identifies which pause state (or its absence,
 * `null`) the caller computed its write from. A miss means a concurrent
 * apply/pause/resume already moved the stamp, and that write must win over
 * this one rather than get overwritten. Field-level races between writers
 * that change NEITHER guard field (two settles, a settle vs a sweep claim)
 * are caught by the content predicates commitTicketStamp layers on top — see
 * TicketStampContentGuard. Mirrors sla.service.ts's slaStampGuard.
 */
export function ticketSlaStampGuard(
  ticketId: TicketId,
  appliedAt: string,
  pausedAt: string | null
) {
  return and(
    eq(tickets.id, ticketId),
    sql`${tickets.slaApplied} ->> 'appliedAt' = ${appliedAt}`,
    pausedAt === null
      ? sql`${tickets.slaApplied} ->> 'pausedAt' IS NULL`
      : sql`${tickets.slaApplied} ->> 'pausedAt' = ${pausedAt}`
  )
}

/** Append one TTR clock event to the log — ticket-anchored, so `ticket_id` is
 *  set and `conversation_id` is explicitly NULL (the sla_events_subject_check
 *  constraint requires exactly one subject; a back-office ticket has no
 *  conversation, and a linked ticket's TTR is still a fact about the ticket).
 *  Takes an executor so the event can travel in the same transaction as the
 *  stamp write it belongs to (see commitTicketClockEvent). Exported for the
 *  sweep module (ticket-sla.sweep.ts), whose breach pass logs through the
 *  same single meta shape and the same atomic claim + insert pairing. */
export async function insertTicketClockEvent(
  ticketId: TicketId,
  policyId: SlaPolicyId,
  kind: string,
  dueAt: string,
  at: Date,
  executor: StampExecutor = db
): Promise<void> {
  const overdueMs = at.getTime() - new Date(dueAt).getTime()
  await executor.insert(slaEvents).values({
    ticketId,
    conversationId: null,
    policyId,
    kind,
    meta: { dueAt, at: at.toISOString(), overdueSecs: Math.max(0, Math.round(overdueMs / 1000)) },
  })
}

/** The ticket twin of sla.service.ts's StampContentGuard — same two predicate
 *  shapes (`unsetFields` the double-write guard, `pinnedFields` the
 *  stale-read guard), keyed on the ticket stamp's fields. */
export interface TicketStampContentGuard {
  unsetFields?: (keyof TicketSlaApplied)[]
  pinnedFields?: Partial<Record<keyof TicketSlaApplied, string | null>>
}

/**
 * Merge a TTR stamp mutation into the live stamp — the ticket twin of
 * sla.service.ts's commitStamp, under the identical write contract (see its
 * doc): MERGE only the fields this writer owns via jsonb `||` (never rewrite
 * the whole stamp — a concurrent writer's disjoint fields survive), guarded
 * by the identity CAS (ticketSlaStampGuard) plus `content` field predicates,
 * so a same-field concurrent writer makes this write miss rather than get
 * clobbered. Returns whether the write landed; a caller whose guard misses
 * must reload the stamp and recompute before retrying (see
 * recordTicketResolution). Used directly, under commitTicketClockEvent when
 * the mutation travels with a clock event, and by ticket-sla.sweep.ts's
 * marker claims.
 */
export async function commitTicketStamp(
  ticketId: TicketId,
  patch: Partial<TicketSlaApplied>,
  at: Date,
  guard: { appliedAt: string; pausedAt: string | null },
  content: TicketStampContentGuard = {},
  executor: StampExecutor = db
): Promise<boolean> {
  const [row] = await executor
    .update(tickets)
    .set({
      slaApplied: sql`${tickets.slaApplied} || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: at,
    })
    .where(
      and(
        ticketSlaStampGuard(ticketId, guard.appliedAt, guard.pausedAt),
        ...(content.unsetFields ?? []).map(
          (field) => sql`(${tickets.slaApplied} ->> ${field}) IS NULL`
        ),
        ...Object.entries(content.pinnedFields ?? {}).map(([field, value]) =>
          value === null
            ? sql`(${tickets.slaApplied} ->> ${field}) IS NULL`
            : sql`(${tickets.slaApplied} ->> ${field}) = ${value}`
        )
      )
    )
    .returning({ id: tickets.id })
  return Boolean(row)
}

/** Persist a stamp mutation + append one clock event in a single spot — and,
 *  in a single TRANSACTION (the ticket twin of sla.service.ts's
 *  commitClockEvent): the event is the durable record of the stamp change, so
 *  the two must land atomically or not at all. Same guarded merge as
 *  commitTicketStamp — the event is logged only when the stamp write landed,
 *  and a guard miss commits nothing. */
async function commitTicketClockEvent(
  ticketId: TicketId,
  policyId: SlaPolicyId,
  patch: Partial<TicketSlaApplied>,
  kind: string,
  dueAt: string,
  at: Date,
  guard: { appliedAt: string; pausedAt: string | null },
  content: TicketStampContentGuard
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await commitTicketStamp(ticketId, patch, at, guard, content, tx))) return false
    await insertTicketClockEvent(ticketId, policyId, kind, dueAt, at, tx)
    return true
  })
}

/**
 * Apply a policy to a ticket: compute the office-hours-aware TTR deadline,
 * stamp `tickets.sla_applied`, and log an 'applied' event (ticket-anchored —
 * conversation_id NULL). Re-applying replaces the active SLA (one per ticket).
 * `at` is injectable so callers/tests pin the clock origin.
 *
 * A policy that doesn't track time-to-resolve is a silent no-op (returns
 * null, no stamp, no event): the disjoint-targets rule means conversation-only
 * policies legitimately flow through here from the link handoff, which can't
 * know the policy's targets without a fetch — this keeps that check in ONE
 * place. TRACKER tickets are rejected outright (an umbrella's own status is a
 * fan-out of its linked tickets', never a resolution clock). A ticket already
 * in a 'closed'-CATEGORY status is likewise a silent no-op: an armed TTR
 * clock on a closed ticket could only ever breach (the close that would have
 * settled it already happened), so stamping one manufactures a guaranteed
 * false breach. Apply-while-paused: a ticket already in a 'pending'-category
 * status under a pauseOnPending policy starts its clock already paused
 * (pausedAt = appliedAt) — the pending state predated the apply, so no pause
 * event will ever arrive for it. Returns the stamped SLA, or null for the
 * no-TTR / already-closed no-ops.
 */
export async function applySlaToTicket(
  ticketId: TicketId,
  policyId: SlaPolicyId,
  at: Date = new Date()
): Promise<TicketSlaApplied | null> {
  const policy = await getSlaPolicy(policyId)
  if (!policy) throw new Error(`SLA policy ${policyId} not found`)

  const [ticket] = await db
    .select({ id: tickets.id, type: tickets.type, statusCategory: ticketStatuses.category })
    .from(tickets)
    .innerJoin(ticketStatuses, eq(tickets.statusId, ticketStatuses.id))
    .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
    .limit(1)
  if (!ticket) throw new NotFoundError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`)
  if (ticket.type === 'tracker') {
    throw new ValidationError(
      'TRACKER_SLA_REJECTED',
      'SLAs cannot be applied to tracker tickets — a tracker umbrellas other tickets and has no resolution clock of its own'
    )
  }
  if (!policy.timeToResolveTargetSecs) return null
  if (ticket.statusCategory === 'closed') return null

  const schedule = await resolveScheduleFor(policy)
  const applied: TicketSlaApplied = {
    policyId: policy.id,
    policyName: policy.name,
    appliedAt: at.toISOString(),
    // The schedule snapshot is the stamp's own (see the field's doc on
    // TicketSlaApplied): a trimmed copy, never the live row/blob reference.
    scheduleSnapshot: {
      timezone: schedule.timezone,
      intervals: schedule.intervals,
      holidays: schedule.holidays ?? [],
    },
    timeToResolveDueAt: addOfficeHoursSeconds(
      schedule,
      at,
      policy.timeToResolveTargetSecs
    ).toISOString(),
    resolvedAt: null,
    pauseOnPending: policy.pauseOnPending,
    pausedAt:
      ticket.statusCategory === 'pending' && policy.pauseOnPending ? at.toISOString() : null,
  }

  await db
    .update(tickets)
    .set({ slaApplied: applied, updatedAt: at })
    .where(eq(tickets.id, ticketId))

  await db.insert(slaEvents).values({
    ticketId,
    conversationId: null,
    policyId: policy.id,
    kind: 'applied',
    meta: { timeToResolveDueAt: applied.timeToResolveDueAt },
  })

  return applied
}

/**
 * Record the ticket's first resolution against the TTR clock and log
 * met/breached. Driven by sla.event-hooks.ts's ticket.status_changed case on
 * entering a 'closed'-category status. Idempotent in the strong sense: once
 * `resolvedAt` is set the clock is settled PERMANENTLY — a reopen clears the
 * ticket row's own resolvedAt (ticket.lifecycle) but never the stamp's, so a
 * re-close settles nothing again (see this module's doc for the
 * first-resolution rule). A no-op when no SLA is applied (trackers can never
 * have one — applySlaToTicket refuses them — so the cascaded status moves a
 * tracker fans onto its linked tickets evaluate each linked ticket's own
 * stamp, independently).
 *
 * Settling judges against dueAtForSettle (pause-adjusted): a ticket closed
 * straight out of 'pending' settles against the deadline shifted by the
 * elapsed pause up to `at`, exactly like the conversation's settle-mid-snooze.
 * When the sweep already noted the breach (resolutionBreachedAt is set), the
 * close only settles the clock — no second BREACH event — but a
 * `time_to_resolve_settled_after_breach` event IS logged (meta.overdueSecs
 * carries the lag from the pause-adjusted due date to the settle) so
 * time-after-miss reporting can measure how late it landed.
 *
 * Guarded and retried on a CAS miss exactly like sla.service.ts's
 * recordResolution (see that doc comment): a concurrent pause/resume landing
 * between this function's read and its write loses the CAS, the stamp is
 * reloaded, and the settle is recomputed exactly once against the fresh
 * state. `preloaded` lets the event hook's direct pending -> closed path
 * thread resumeTicketSlaFromPending's return (the post-resume stamp it just
 * wrote) instead of paying for a second SELECT of the same row; pass `null`
 * (resume was a no-op) or omit it and the `??` fallback loads as usual.
 */
export async function recordTicketResolution(
  ticketId: TicketId,
  at: Date = new Date(),
  preloaded?: TicketSlaApplied | null
): Promise<void> {
  let applied = preloaded ?? (await loadTicketSlaApplied(ticketId))
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || applied.resolvedAt) return
    const guard = { appliedAt: applied.appliedAt, pausedAt: applied.pausedAt ?? null }
    let committed: boolean
    if (applied.resolutionBreachedAt) {
      // Settle-only (the breach event stays exactly-once), but log the late
      // settle itself for time-after-miss reporting. The content CAS re-checks
      // the outcome field itself: a concurrent settle that landed first owns
      // it, and this write must miss rather than double-log the settle.
      committed = await commitTicketClockEvent(
        ticketId,
        applied.policyId,
        { resolvedAt: at.toISOString() },
        'time_to_resolve_settled_after_breach',
        dueAtForSettle(applied.timeToResolveDueAt, applied.pausedAt, at).toISOString(),
        at,
        guard,
        { unsetFields: ['resolvedAt'] }
      )
    } else {
      const dueAt = dueAtForSettle(applied.timeToResolveDueAt, applied.pausedAt, at)
      const breached = at.getTime() > dueAt.getTime()
      committed = await commitTicketClockEvent(
        ticketId,
        applied.policyId,
        breached
          ? { resolvedAt: at.toISOString(), resolutionBreachedAt: at.toISOString() }
          : { resolvedAt: at.toISOString() },
        breached ? 'time_to_resolve_breached' : 'time_to_resolve_met',
        dueAt.toISOString(),
        at,
        guard,
        // When this settle logs the breach itself, the breach-noted marker is
        // part of the content CAS too: a sweep claim that landed first owns
        // it, and this settle must miss + reload into the settle-after-breach
        // path above rather than double-log the breach.
        { unsetFields: breached ? ['resolvedAt', 'resolutionBreachedAt'] : ['resolvedAt'] }
      )
    }
    if (committed) return
    applied = await loadTicketSlaApplied(ticketId)
  }
}

/**
 * Pause-on-pending (support platform §4.6): when a ticket with an active SLA
 * whose policy opted into `pauseOnPending` enters a 'pending'-category status,
 * stamp the moment the clock stopped. The stamped deadline itself is left
 * untouched here; it only shifts once the paused duration is known, on
 * resume. Uses the shared guarded merge-write (commitTicketStamp): the patch
 * is `pausedAt` alone, so a settle racing the pause keeps its own fields, and
 * the identity CAS on `(appliedAt, pausedAt: null)` means a concurrent
 * apply/pause/resume/settle wins instead of getting clobbered; a guard miss
 * quietly skips rather than overwriting a newer stamp (the same trade-off
 * sla.service.ts's pauseSlaOnSnooze documents). A no-op without an
 * applied SLA, when the policy opted out of pausing, or when the clock is
 * already paused (idempotent against a duplicate event — e.g. a lateral
 * pending -> pending status move never re-pauses, and the hook's
 * previousStatus check already filters those upstream anyway).
 */
export async function pauseTicketSlaOnPending(
  ticketId: TicketId,
  at: Date = new Date()
): Promise<void> {
  const applied = await loadTicketSlaApplied(ticketId)
  if (!applied || applied.pauseOnPending === false || applied.pausedAt) return

  const landed = await commitTicketStamp(ticketId, { pausedAt: at.toISOString() }, at, {
    appliedAt: applied.appliedAt,
    pausedAt: null,
  })
  if (!landed) return

  await db.insert(slaEvents).values({
    ticketId,
    conversationId: null,
    policyId: applied.policyId,
    kind: 'paused',
    meta: { at: at.toISOString() },
  })
}

/**
 * Resume-from-pending: shift the still-unsettled TTR deadline forward by the
 * paused duration (now - pausedAt) and clear the pause. An already-settled
 * clock's deadline is left untouched, since it settled against whatever was
 * live at the time, pause or not. The shift is a plain wall-clock delta
 * rather than re-run through office-hours math, so on a schedule with closed
 * hours inside the paused span this is a slight approximation; simple and
 * exact for the common 24/7 case (the same trade-off the conversation's
 * resume makes — see sla.service.ts's resumeSlaFromSnooze). Same guarded
 * merge-write as pauseTicketSlaOnPending. A no-op (returning
 * null) without an applied SLA or when the clock isn't currently paused;
 * otherwise returns the post-resume stamp it wrote, so the event hook's
 * direct pending -> closed path can settle against it without reloading.
 */
export async function resumeTicketSlaFromPending(
  ticketId: TicketId,
  at: Date = new Date()
): Promise<TicketSlaApplied | null> {
  const applied = await loadTicketSlaApplied(ticketId)
  if (!applied || !applied.pausedAt) return null

  const pausedAt = applied.pausedAt
  const shiftMs = Math.max(0, at.getTime() - new Date(pausedAt).getTime())
  // The merge patch carries ONLY the fields resume owns: the cleared pause
  // plus the deadline shift when the clock is still unsettled (a settled
  // clock's due is left out of the patch entirely — it settled against
  // whatever was live at the time).
  const patch: Partial<TicketSlaApplied> = { pausedAt: null }
  if (!applied.resolvedAt) {
    patch.timeToResolveDueAt = shiftIso(applied.timeToResolveDueAt, shiftMs)
  }

  const landed = await commitTicketStamp(ticketId, patch, at, {
    appliedAt: applied.appliedAt,
    pausedAt,
  })
  if (!landed) return null

  await db.insert(slaEvents).values({
    ticketId,
    conversationId: null,
    policyId: applied.policyId,
    kind: 'resumed',
    meta: { pausedForSecs: Math.round(shiftMs / 1000), at: at.toISOString() },
  })
  // Reconstruct the post-write stamp (exactly what the merge produced) for
  // the event hook's direct pending -> closed path — see this function's doc
  // above.
  return { ...applied, ...patch }
}
