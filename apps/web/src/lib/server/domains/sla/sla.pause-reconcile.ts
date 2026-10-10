/**
 * Bring a stamp's pause state in line with the entity's paused spans (see
 * sla.pause-history.ts). Every SLA reaction for a conversation or a ticket
 * runs this first, so however its pause and resume reactions arrive (late,
 * out of order, retried or twice) the stamp ends as the in-order run leaves it.
 *
 * The stamp's ledger, `pausedSpans`, lists the spans already excluded from its
 * unsettled deadlines, and `pausedAt` starts the span it holds open. A
 * reconcile:
 *
 *  1. closes the span the stamp holds open at the end the history records
 *     (a wake reacted to late, even after the next pause began, ends the
 *     first pause at its own time and never excludes the active time after
 *     it);
 *  2. excludes every completed span the ledger lacks (a pause reacted to
 *     after its wake);
 *  3. holds the current span open.
 *
 * A span shifts each unsettled clock by its overlap with that clock's run: from
 * the SLA's application for first response, time-to-close and time-to-resolve,
 * from the cycle's opener for next response. A settled clock is not shifted;
 * its settle judged the paused time up to it (dueAsOf). The paused and resumed
 * clock events are logged with the ledger change, in one transaction pinned to
 * the ledger revision, so a span is excluded and logged exactly once.
 *
 * A stamp from before the ledger excluded its earlier spans as they ended: its
 * first reconcile adopts every completed span it does not hold open, without
 * shifting again.
 */
import { db, slaEvents } from '@/lib/server/db'
import type { ConversationId, SlaPolicyId, TicketId } from '@quackback/ids'
import { commitStamp, loadSlaApplied, shiftIso, type SlaApplied } from './sla.service'
import {
  commitTicketStamp,
  loadTicketSlaApplied,
  type TicketSlaApplied,
} from './ticket-sla.service'
import {
  overlapMs,
  pendingSpans,
  snoozedSpans,
  type ExcludedSpan,
  type PausedSpan,
} from './sla.pause-history'

/** One deadline a pause shifts: its fields on the stamp, and when its clock started. */
interface Clock {
  dueField: string
  settledField: string
  from: number
}

type Stamp = Record<string, unknown> & {
  pausedAt?: string | null
  pausedSpans?: ExcludedSpan[]
  pauseRevision?: number
}

interface ClockEvent {
  kind: 'paused' | 'resumed'
  meta: Record<string, unknown>
}

interface Plan {
  patch: Record<string, unknown>
  pinnedFields: Record<string, string | null>
  unsetFields: string[]
  events: ClockEvent[]
}

const NEVER = Number.POSITIVE_INFINITY
const ms = (iso: string) => new Date(iso).getTime()
const iso = (at: number) => new Date(at).toISOString()

const pausedEvent = (from: number): ClockEvent => ({ kind: 'paused', meta: { at: iso(from) } })
const resumedEvent = (from: number, until: number): ClockEvent => ({
  kind: 'resumed',
  meta: { pausedForSecs: Math.round((until - from) / 1000), at: iso(until) },
})

/** The ledger writes that bring `stamp` in line with `spans`, or null when it already is. */
function planPauses(stamp: Stamp, spans: PausedSpan[], clocks: Clock[]): Plan | null {
  const history = spans.map((span) => ({
    from: span.from.getTime(),
    until: span.until ? span.until.getTime() : null,
  }))
  const completed = history.filter((span): span is { from: number; until: number } =>
    Boolean(span.until)
  )
  const open = history.find((span) => span.until === null) ?? null
  let pausedAt = stamp.pausedAt ? ms(stamp.pausedAt) : null
  const within = (span: { from: number; until: number | null }, at: number) =>
    span.from <= at && (span.until === null || at < span.until)

  const accounted = stamp.pausedSpans
    ? stamp.pausedSpans.map((span) => ({ from: ms(span.from), until: ms(span.until) }))
    : completed.filter((span) => pausedAt === null || !within(span, pausedAt))
  let changed = !stamp.pausedSpans
  const shifts = new Map<Clock, number>()
  const events: ClockEvent[] = []
  const exclude = (from: number, until: number) => {
    for (const clock of clocks) {
      if (!stamp[clock.dueField] || stamp[clock.settledField]) continue
      const shift = overlapMs(from, until, clock.from, NEVER)
      if (shift > 0) shifts.set(clock, (shifts.get(clock) ?? 0) + shift)
    }
    accounted.push({ from, until })
    changed = true
  }

  // 1. The span the stamp holds open, closed where the history ends it.
  if (pausedAt !== null) {
    const holding = history.find((span) => within(span, pausedAt as number))
    if (holding?.until) {
      exclude(pausedAt, holding.until)
      events.push(resumedEvent(pausedAt, holding.until))
      pausedAt = null
    }
  }
  // 2. Every completed span the ledger lacks.
  for (const span of completed) {
    const inLedger = accounted.some((a) => a.from < span.until && span.from < a.until)
    if (inLedger || (pausedAt !== null && within(span, pausedAt))) continue
    exclude(span.from, span.until)
    events.push(pausedEvent(span.from), resumedEvent(span.from, span.until))
  }
  // 3. The span still open.
  if (open && pausedAt === null && !accounted.some((a) => open.from < a.until)) {
    pausedAt = open.from
    events.push(pausedEvent(open.from))
    changed = true
  }
  if (!changed) return null

  const patch: Record<string, unknown> = {
    pausedAt: pausedAt === null ? null : iso(pausedAt),
    pausedSpans: accounted.map((span) => ({ from: iso(span.from), until: iso(span.until) })),
    pauseRevision: (stamp.pauseRevision ?? 0) + 1,
  }
  const pinnedFields: Record<string, string | null> = {
    pauseRevision: stamp.pauseRevision === undefined ? null : String(stamp.pauseRevision),
  }
  const unsetFields: string[] = []
  for (const [clock, shift] of shifts) {
    const due = stamp[clock.dueField] as string
    patch[clock.dueField] = shiftIso(due, shift)
    pinnedFields[clock.dueField] = due
    unsetFields.push(clock.settledField)
  }
  return { patch, pinnedFields, unsetFields, events }
}

function logged(
  events: ClockEvent[],
  owner: { conversationId: ConversationId | null; ticketId?: TicketId },
  policyId: SlaPolicyId
) {
  return events.map((event) => ({ ...owner, policyId, kind: event.kind, meta: event.meta }))
}

/** Reconcile a conversation's stamp with its snoozed spans. `at` stamps the row's update. */
export async function reconcileSnoozePauses(
  conversationId: ConversationId,
  at: Date
): Promise<void> {
  let applied = await loadSlaApplied(conversationId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || applied.pauseOnSnooze === false) return
    const appliedAt = ms(applied.appliedAt)
    const plan = planPauses(
      applied as Stamp,
      await snoozedSpans(conversationId, new Date(appliedAt)),
      [
        { dueField: 'firstResponseDueAt', settledField: 'firstResponseAt', from: appliedAt },
        {
          dueField: 'nextResponseDueAt',
          settledField: 'nextResponseAt',
          from: applied.nextResponseCycleAt ? ms(applied.nextResponseCycleAt) : appliedAt,
        },
        { dueField: 'timeToCloseDueAt', settledField: 'resolvedAt', from: appliedAt },
      ]
    )
    if (!plan) return
    const stamp = applied
    const committed = await db.transaction(async (tx) => {
      const landed = await commitStamp(
        conversationId,
        plan.patch as Partial<SlaApplied>,
        at,
        { appliedAt: stamp.appliedAt, pausedAt: stamp.pausedAt ?? null },
        {
          pinnedFields: plan.pinnedFields as Partial<Record<keyof SlaApplied, string | null>>,
          unsetFields: plan.unsetFields as (keyof SlaApplied)[],
        },
        tx
      )
      if (landed && plan.events.length > 0) {
        await tx.insert(slaEvents).values(logged(plan.events, { conversationId }, stamp.policyId))
      }
      return landed
    })
    if (committed) return
    applied = await loadSlaApplied(conversationId)
  }
}

/** Reconcile a ticket's stamp with its pending spans. `at` stamps the row's update. */
export async function reconcilePendingPauses(ticketId: TicketId, at: Date): Promise<void> {
  let applied = await loadTicketSlaApplied(ticketId)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!applied || applied.pauseOnPending === false) return
    const appliedAt = ms(applied.appliedAt)
    const plan = planPauses(applied as Stamp, await pendingSpans(ticketId, new Date(appliedAt)), [
      { dueField: 'timeToResolveDueAt', settledField: 'resolvedAt', from: appliedAt },
    ])
    if (!plan) return
    const stamp = applied
    const committed = await db.transaction(async (tx) => {
      const landed = await commitTicketStamp(
        ticketId,
        plan.patch as Partial<TicketSlaApplied>,
        at,
        { appliedAt: stamp.appliedAt, pausedAt: stamp.pausedAt ?? null },
        {
          pinnedFields: plan.pinnedFields as Partial<Record<keyof TicketSlaApplied, string | null>>,
          unsetFields: plan.unsetFields as (keyof TicketSlaApplied)[],
        },
        tx
      )
      if (landed && plan.events.length > 0) {
        await tx
          .insert(slaEvents)
          .values(logged(plan.events, { conversationId: null, ticketId }, stamp.policyId))
      }
      return landed
    })
    if (committed) return
    applied = await loadTicketSlaApplied(ticketId)
  }
}
