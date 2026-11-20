/**
 * Ticket due dates: the one shared contract every surface reads.
 *
 * A ticket carries ONE due date (`tickets.due_at`): the customer can propose
 * it when they file the ticket ("Needed by"), and a teammate can set, change
 * or clear it. Both sides see the same value. It is independent of SLA
 * targets, which live in `sla_applied` and have their own countdown.
 *
 * Pure and dependency-free (no zod, no error classes) so the widget bundle can
 * import it. The wire format is an ISO instant (`ticketDueAtWireSchema` in
 * `schemas/tickets.ts`); the window below is enforced server-side by
 * `assertTicketDueAt`.
 */

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** Who is setting the date: a customer filing a ticket, or a teammate. */
export type TicketDueAudience = 'customer' | 'team'

/** Why a due date is out of bounds; null when it is acceptable. */
export type TicketDueProblem = 'invalid' | 'past' | 'too_far' | 'too_old'

/**
 * How far in the past a customer's date may sit: covers clock skew and a form
 * picked just before midnight and submitted just after.
 */
export const TICKET_DUE_PAST_GRACE_MS = 15 * MINUTE_MS
/** Two years ahead, plus a day so every time zone can pick the same calendar date. */
export const TICKET_DUE_CUSTOMER_MAX_DAYS = 731
export const TICKET_DUE_TEAM_MAX_DAYS = 5 * 365
/** Teammates may record a date that already passed (e.g. backfilling a commitment). */
export const TICKET_DUE_TEAM_MAX_PAST_DAYS = 365

/** "Due soon" means within the next 24 hours: the filter, row marker and alert all agree. */
export const TICKET_DUE_SOON_WINDOW_MS = DAY_MS

/** The allowed window for a due date set by `audience`, relative to `now`. */
export function ticketDueBounds(
  audience: TicketDueAudience,
  now: Date = new Date()
): { min: Date; max: Date } {
  const t = now.getTime()
  if (audience === 'customer') {
    return {
      min: new Date(t - TICKET_DUE_PAST_GRACE_MS),
      max: new Date(t + TICKET_DUE_CUSTOMER_MAX_DAYS * DAY_MS),
    }
  }
  return {
    min: new Date(t - TICKET_DUE_TEAM_MAX_PAST_DAYS * DAY_MS),
    max: new Date(t + TICKET_DUE_TEAM_MAX_DAYS * DAY_MS),
  }
}

/** The reason `at` is not an acceptable due date for `audience`, or null. */
export function ticketDueProblem(
  at: Date | null,
  audience: TicketDueAudience,
  now: Date = new Date()
): TicketDueProblem | null {
  if (!at || Number.isNaN(at.getTime())) return 'invalid'
  const { min, max } = ticketDueBounds(audience, now)
  if (at.getTime() > max.getTime()) return 'too_far'
  if (at.getTime() < min.getTime()) return audience === 'customer' ? 'past' : 'too_old'
  return null
}

/**
 * A customer's "Needed by Oct 21" means by the end of Oct 21 where THEY are,
 * so a picked calendar day becomes 23:59 in the viewer's local time zone (the
 * `Date` constructor handles daylight-saving shifts). Returns null for a
 * malformed or impossible date (e.g. `2026-02-30`).
 */
export function endOfLocalDay(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d, 23, 59, 0, 0)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

/** `YYYY-MM-DD` for `date` in the viewer's local time zone (for `<input type="date">`). */
export function toLocalDateInputValue(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/** The inbox due filters: overdue, due within the soon window, or no due date. */
export const TICKET_DUE_FILTERS = ['overdue', 'due_soon', 'none'] as const
export type TicketDueFilter = (typeof TICKET_DUE_FILTERS)[number]

export function isTicketDueFilter(value: unknown): value is TicketDueFilter {
  return typeof value === 'string' && (TICKET_DUE_FILTERS as readonly string[]).includes(value)
}

/** Where a ticket stands against its due date. */
export type TicketDueState = 'overdue' | 'due_soon' | 'scheduled'

/**
 * The due state of an open ticket, or null when there is nothing to show (no
 * due date, or the ticket is closed). Shared by the row marker, the detail
 * chip and the filter so all three agree on what "due soon" means.
 */
export function ticketDueState(
  dueAt: string | Date | null | undefined,
  closed: boolean,
  now: Date
): TicketDueState | null {
  if (!dueAt || closed) return null
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null
  const remaining = due.getTime() - now.getTime()
  if (remaining <= 0) return 'overdue'
  if (remaining <= TICKET_DUE_SOON_WINDOW_MS) return 'due_soon'
  return 'scheduled'
}

/**
 * The alert markers to write alongside a new due date. Each marker holds the
 * `due_at` value the ticket-due sweep already alerted for; a marker equal to
 * the new date suppresses that alert.
 *
 * - No due date: both clear.
 * - A date already in the past: both suppressed (setting a past date is a
 *   record, not news).
 * - The assignee setting a near-term date on their own ticket: no "due soon"
 *   alert (they just decided it), but the overdue alert still fires.
 * - Otherwise: both armed.
 */
export function dueAlertMarkersOnSet(input: {
  dueAt: Date | null
  now: Date
  actorIsAssignee: boolean
}): { dueSoonNotifiedFor: Date | null; overdueNotifiedFor: Date | null } {
  const { dueAt, now, actorIsAssignee } = input
  if (!dueAt) return { dueSoonNotifiedFor: null, overdueNotifiedFor: null }
  const remaining = dueAt.getTime() - now.getTime()
  if (remaining <= 0) return { dueSoonNotifiedFor: dueAt, overdueNotifiedFor: dueAt }
  if (actorIsAssignee && remaining <= TICKET_DUE_SOON_WINDOW_MS) {
    return { dueSoonNotifiedFor: dueAt, overdueNotifiedFor: null }
  }
  return { dueSoonNotifiedFor: null, overdueNotifiedFor: null }
}
