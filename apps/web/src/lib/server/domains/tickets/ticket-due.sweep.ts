/**
 * Ticket due-date alerts: the per-minute sweep that fires `ticket.due_soon`
 * once an open ticket's due date is within 24 hours and `ticket.overdue` once
 * it has passed. Both events reach the bell, email, webhooks and workflow
 * triggers through the ordinary event spine; this module only decides WHEN.
 *
 * Fire-once per due date, without a reset write: each of the two markers
 * (`due_soon_notified_for`, `overdue_notified_for`) holds the `due_at` value
 * it already alerted for. Moving the date makes both markers stale, which
 * re-arms both alerts for the new date; `setTicketDueAt` additionally writes
 * suppressing markers when a fresh alert would be noise (see
 * dueAlertMarkersOnSet).
 *
 * Claim-after-enqueue, mirroring workflow-sweep.ts's sweepSlaTimerTriggers:
 * the scan never claims, each candidate's dispatch is enqueued first under a
 * deterministic event id (see dueAlertEventId) and only then is the marker
 * claimed. A dispatch failure leaves the marker unclaimed and the next tick
 * retries; a sibling tick racing the same candidate enqueues the same id and
 * the outbox dedupes it. The claim is a compare-and-set pinned to the scanned
 * `due_at`, so a date moved between scan and claim is never marked as alerted.
 *
 * The claim never bumps `updated_at`: the column drives the inbox's "recent"
 * sort, and a timer noticing a deadline is not activity on the ticket.
 *
 * Wired by ticket-due-sweep-queue.ts (deadline provider + cron gate) and the
 * `ticket-due-sweep` job in jobs/definitions.ts.
 */
import {
  db,
  and,
  eq,
  or,
  asc,
  inArray,
  sql,
  tickets,
  ticketStatuses,
  type Ticket,
} from '@/lib/server/db'
import type { TicketId } from '@quackback/ids'
import { notTestTicket } from '@/lib/server/test-data'
import { logger } from '@/lib/server/logger'
import { dispatchTicketDueSoon, dispatchTicketOverdue } from '@/lib/server/events/dispatch'
import type { TicketDueAlertPayload } from '@/lib/server/events/types'
import { TICKET_DUE_SOON_WINDOW_MS } from '@/lib/shared/ticket-due'
import { ticketRef } from './ticket.webhooks'

const log = logger.child({ component: 'ticket-due-sweep' })

/** Upper bound on tickets handled per sweep run; anything beyond waits for the
 *  next tick (the scan keeps re-finding it until its marker is claimed). */
export const TICKET_DUE_SWEEP_BATCH_LIMIT = 200

export type TicketDueAlertKind = 'due_soon' | 'overdue'

/**
 * The deterministic event id for one alert: one per ticket, per kind, per due
 * date. A repeat tick for the same date reuses it (outbox dedupe), and a moved
 * date mints a new one, so subscribers can dedupe on it too.
 */
export function dueAlertEventId(kind: TicketDueAlertKind, ticketId: string, dueAtIso: string) {
  return `timer:ticket.${kind}:${ticketId}:${dueAtIso}`
}

/**
 * The `tickets_due_alert_pending_idx` partial-index predicate (migration
 * 0305), VERBATIM, so the planner proves the index applies via a literal
 * clause match: open, live tickets with a due date whose overdue alert has
 * not fired for that date yet.
 */
export function dueAlertPendingSql() {
  return sql`${tickets.dueAt} IS NOT NULL AND ${tickets.resolvedAt} IS NULL AND ${tickets.deletedAt} IS NULL AND ${tickets.overdueNotifiedFor} IS DISTINCT FROM ${tickets.dueAt}`
}

const DUE_SOON_WINDOW_SECS = TICKET_DUE_SOON_WINDOW_MS / 1000

/**
 * When this workspace next has a due-date alert to send, or null when it has
 * none.
 *
 * Per pending ticket the next instant is the start of its due-soon window
 * while that alert is still armed for the current date, else the due date
 * itself (the overdue alert). Tickets whose overdue alert already fired for
 * their date fall outside the partial index, so a workspace whose every alert
 * has fired answers null and its compute can suspend. Test tickets are left
 * out exactly as the sweep leaves them out.
 *
 * A ticket on a closed-category status that never got `resolved_at` (a legacy
 * gap) is still pending here, so its instant wakes the sweep, which then
 * claims its markers silently.
 */
export async function nextTicketDueAlertAt(): Promise<Date | null> {
  const [row] = await db
    .select({
      at: sql<Date | string | null>`min(CASE
        WHEN ${tickets.dueSoonNotifiedFor} IS DISTINCT FROM ${tickets.dueAt}
        THEN ${tickets.dueAt} - make_interval(secs => ${DUE_SOON_WINDOW_SECS})
        ELSE ${tickets.dueAt} END)`,
    })
    .from(tickets)
    .where(and(dueAlertPendingSql(), notTestTicket(tickets.id)))
  const value = row?.at ?? null
  if (value === null) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

/** A scanned candidate: the ticket row (for its event ref) plus its status
 *  category. */
interface DueSweepRow {
  ticket: Ticket
  category: 'open' | 'pending' | 'closed'
}

/**
 * Claim one or both markers for a scanned ticket. Compare-and-set on the
 * scanned due date: a date moved since the scan misses (the new date has its
 * own alerts to send). The markers take the column's own `due_at` so they
 * equal it exactly, whatever precision it was stored with; the comparison
 * truncates to the millisecond the scan's JS Date carries for the same
 * reason. `updated_at` is pinned to itself to defeat the schema's `$onUpdate`.
 */
async function claimDueAlertMarkers(
  ticketId: TicketId,
  scannedDueAt: Date,
  markers: 'due_soon' | 'both'
): Promise<boolean> {
  const unclaimed =
    markers === 'both'
      ? or(
          sql`${tickets.overdueNotifiedFor} IS DISTINCT FROM ${tickets.dueAt}`,
          sql`${tickets.dueSoonNotifiedFor} IS DISTINCT FROM ${tickets.dueAt}`
        )
      : sql`${tickets.dueSoonNotifiedFor} IS DISTINCT FROM ${tickets.dueAt}`
  const rows = await db
    .update(tickets)
    .set({
      dueSoonNotifiedFor: sql`${tickets.dueAt}`,
      ...(markers === 'both' ? { overdueNotifiedFor: sql`${tickets.dueAt}` } : {}),
      updatedAt: sql`${tickets.updatedAt}`,
    })
    .where(
      and(
        eq(tickets.id, ticketId),
        sql`date_trunc('milliseconds', ${tickets.dueAt}) = ${scannedDueAt.toISOString()}::timestamptz`,
        unclaimed
      )
    )
    .returning({ id: tickets.id })
  return rows.length > 0
}

function alertPayload(ticket: Ticket, dueAtIso: string): TicketDueAlertPayload {
  return { ticket: ticketRef(ticket), title: ticket.title, dueAt: dueAtIso }
}

export interface TicketDueSweepResult {
  /** `ticket.due_soon` alerts enqueued and claimed. */
  dueSoon: number
  /** `ticket.overdue` alerts enqueued and claimed. */
  overdue: number
  /** Closed-category tickets whose markers were claimed without an alert. */
  silenced: number
}

/**
 * Send every due-date alert that is due at `now`, up to
 * TICKET_DUE_SWEEP_BATCH_LIMIT tickets per run, earliest due date first.
 *
 * The scan repeats the partial-index predicate verbatim (see
 * dueAlertPendingSql) and narrows it to tickets that have something to do:
 * already due (the overdue alert), or due within the window with the due-soon
 * alert still armed. A ticket whose due-soon alert fired and whose date has
 * not passed yet is left out, so a long tail of those can never crowd an
 * actionable ticket out of the batch. Per ticket:
 *
 *  - closed-category status (resolved_at missing, a legacy gap): both markers
 *    claimed silently, nothing sent;
 *  - due date passed: `ticket.overdue`, then both markers claimed (a due-soon
 *    alert that never went out is moot once the ticket is overdue);
 *  - within the window: `ticket.due_soon`, then its marker claimed.
 *
 * A failed dispatch is logged and its marker left unclaimed for the next tick;
 * the rest of the batch carries on. `ticketIds` scopes the scan (tests).
 */
export async function sweepTicketDueAlerts(
  now: Date = new Date(),
  ticketIds?: TicketId[]
): Promise<TicketDueSweepResult> {
  const result: TicketDueSweepResult = { dueSoon: 0, overdue: 0, silenced: 0 }
  const nowIso = now.toISOString()
  const horizonIso = new Date(now.getTime() + TICKET_DUE_SOON_WINDOW_MS).toISOString()

  const rows: DueSweepRow[] = await db
    .select({ ticket: tickets, category: ticketStatuses.category })
    .from(tickets)
    .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
    .where(
      and(
        dueAlertPendingSql(),
        notTestTicket(tickets.id),
        ticketIds ? inArray(tickets.id, ticketIds) : undefined,
        or(
          sql`${tickets.dueAt} <= ${nowIso}::timestamptz`,
          sql`(${tickets.dueAt} <= ${horizonIso}::timestamptz AND ${tickets.dueSoonNotifiedFor} IS DISTINCT FROM ${tickets.dueAt})`
        )
      )
    )
    .orderBy(asc(tickets.dueAt), asc(tickets.id))
    .limit(TICKET_DUE_SWEEP_BATCH_LIMIT)

  for (const { ticket, category } of rows) {
    const dueAt = ticket.dueAt
    if (!dueAt) continue // excluded by the predicate; narrows the type
    const ticketId = ticket.id as TicketId

    if (category === 'closed') {
      if (await claimDueAlertMarkers(ticketId, dueAt, 'both')) result.silenced++
      continue
    }

    const dueAtIso = dueAt.toISOString()
    const overdue = dueAt.getTime() <= now.getTime()
    if (!overdue && ticket.dueSoonNotifiedFor?.getTime() === dueAt.getTime()) continue

    const kind: TicketDueAlertKind = overdue ? 'overdue' : 'due_soon'
    try {
      const dispatch = overdue ? dispatchTicketOverdue : dispatchTicketDueSoon
      await dispatch(dueAlertEventId(kind, ticketId, dueAtIso), alertPayload(ticket, dueAtIso))
    } catch (err) {
      // Marker left unclaimed: a later tick re-scans and retries.
      log.error(
        { err, ticketId, kind },
        `ticket.${kind} dispatch failed; continuing the rest of the batch`
      )
      continue
    }
    // A miss here only means a sibling tick claimed first or the date moved
    // meanwhile; either way the outbox already holds this alert exactly once.
    if (await claimDueAlertMarkers(ticketId, dueAt, overdue ? 'both' : 'due_soon')) {
      if (overdue) result.overdue++
      else result.dueSoon++
    }
  }
  return result
}
