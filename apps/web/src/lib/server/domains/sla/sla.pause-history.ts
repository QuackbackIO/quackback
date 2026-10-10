/**
 * An entity's paused spans, rebuilt from its history: a conversation is paused
 * while snoozed, a ticket while its status is in the pending category. Also
 * when it was first closed, which settles its time-to-close or time-to-resolve
 * clock.
 *
 * The SLA pause and resume reactions run from queued jobs that can run late,
 * out of order or twice, so they never trust the order their events arrive in.
 * They rebuild the spans from the durable record each time (see
 * sla.pause-reconcile.ts): the entity's status changes in the events log,
 * where a span starts when the status enters the paused state and ends when it
 * leaves it (a move within it, such as between two pending statuses or a
 * snooze extended, is neither), and, for a conversation, its customer
 * messages, each of which wakes a snooze without a status event.
 */
import { db, and, asc, eq, gte, sql, events, conversationMessages } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

/** A paused span; `until` is null while the entity is still paused. */
export interface PausedSpan {
  from: Date
  until: Date | null
}

interface Transition {
  at: Date
  kind: 'enter' | 'leave'
}

/**
 * Moves into and out of `pausedStatus`, from the entity's status-change
 * events. Before its first recorded change the entity had that change's
 * previous status, so a first change out of the paused state (an entity
 * created paused, say) ends a span that began before its history.
 */
async function statusTransitions(
  entityType: 'conversation' | 'ticket',
  entityId: string,
  pausedStatus: 'snoozed' | 'pending'
): Promise<Transition[]> {
  const rows = await db
    .select({ at: events.occurredAt, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.entityType, entityType),
        eq(events.entityId, entityId),
        eq(events.type, `${entityType}.status_changed`)
      )
    )
    .orderBy(asc(events.occurredAt), asc(events.id))
  const moves = rows.map(({ at, payload }) => ({
    at,
    ...(payload as { previousStatus?: string; newStatus?: string }),
  }))
  // The epoch stands for the start of the history; spansFrom clips a span
  // from it to the SLA's application.
  const transitions: Transition[] =
    moves[0]?.previousStatus === pausedStatus ? [{ at: new Date(0), kind: 'enter' }] : []
  for (const { at, previousStatus, newStatus } of moves) {
    if (previousStatus !== pausedStatus && newStatus === pausedStatus) {
      transitions.push({ at, kind: 'enter' })
    } else if (previousStatus === pausedStatus && newStatus !== pausedStatus) {
      transitions.push({ at, kind: 'leave' })
    }
  }
  return transitions
}

/**
 * When the entity first entered `status` from `since` on, per its
 * status-change events, or null when it has not. A close reaction can run
 * after a later close's, and the clock settles at the first.
 */
export async function firstStatusSince(
  entityType: 'conversation' | 'ticket',
  entityId: string,
  status: 'closed',
  since: Date
): Promise<Date | null> {
  const [row] = await db
    .select({ at: events.occurredAt })
    .from(events)
    .where(
      and(
        eq(events.entityType, entityType),
        eq(events.entityId, entityId),
        eq(events.type, `${entityType}.status_changed`),
        gte(events.occurredAt, since),
        sql`${events.payload} ->> 'newStatus' = ${status}`
      )
    )
    .orderBy(asc(events.occurredAt))
    .limit(1)
  return row?.at ?? null
}

/**
 * The customer messages that can wake a snooze: for each entry into it, the
 * first customer message after the entry. Every customer message wakes a
 * snoozed conversation, but only the first one after an entry can end a span
 * (a later one finds it awake already), so the spans rebuilt from these are
 * the ones all customer messages give, at one indexed row per entry. A
 * message in the entry's own millisecond is not after it (spansFrom takes a
 * wake before an entry at the same instant), so the lookup starts one
 * millisecond on.
 */
async function customerMessageWakes(
  conversationId: ConversationId,
  enters: Date[]
): Promise<Transition[]> {
  if (enters.length === 0) return []
  // The entries travel as one JSON parameter: a JS array would be flattened
  // into one parameter per element.
  const entries = JSON.stringify(enters.map((at) => at.toISOString()))
  const rows = getExecuteRows<{ ms: string | number | null }>(
    await db.execute(sql`
      select floor(extract(epoch from (
        select ${conversationMessages.createdAt} from ${conversationMessages}
        where ${and(
          eq(conversationMessages.conversationId, conversationId),
          eq(conversationMessages.senderType, 'visitor'),
          eq(conversationMessages.isInternal, false)
        )} and ${conversationMessages.createdAt} >= e.at + interval '1 millisecond'
        order by ${conversationMessages.createdAt} limit 1
      )) * 1000)::bigint as ms
      from (select value::timestamptz as at from jsonb_array_elements_text(${entries}::jsonb)) as e
    `)
  )
  return rows
    .filter((row) => row.ms !== null)
    .map((row) => ({ at: new Date(Number(row.ms)), kind: 'leave' as const }))
}

/**
 * Walk the transitions in time order into spans, and keep the part of each
 * from `since` on. At the same instant a wake is taken before an entry.
 */
function spansFrom(transitions: Transition[], since: Date): PausedSpan[] {
  const ordered = [...transitions].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.kind === 'leave' ? -1 : 1)
  )
  const spans: PausedSpan[] = []
  let open: Date | null = null
  for (const { at, kind } of ordered) {
    if (kind === 'enter' && !open) open = at
    else if (kind === 'leave' && open) {
      spans.push({ from: open, until: at })
      open = null
    }
  }
  if (open) spans.push({ from: open, until: null })
  return spans
    .filter((span) => span.until === null || span.until.getTime() > since.getTime())
    .map((span) => ({
      from: span.from.getTime() < since.getTime() ? since : span.from,
      until: span.until,
    }))
}

/** The conversation's snoozed spans from `since` on. */
export async function snoozedSpans(
  conversationId: ConversationId,
  since: Date
): Promise<PausedSpan[]> {
  const status = await statusTransitions('conversation', conversationId, 'snoozed')
  const enters = status.filter((move) => move.kind === 'enter').map((move) => move.at)
  const wakes = await customerMessageWakes(conversationId, enters)
  return spansFrom([...status, ...wakes], since)
}

/** The ticket's pending spans from `since` on. */
export async function pendingSpans(ticketId: TicketId, since: Date): Promise<PausedSpan[]> {
  return spansFrom(await statusTransitions('ticket', ticketId, 'pending'), since)
}

/** A span a stamp has already excluded from its deadlines. */
export interface ExcludedSpan {
  from: string
  until: string
}

/**
 * The pause state a stamp carries: `pausedSpans` lists the spans already
 * excluded from its unsettled deadlines, and `pausedAt` starts the span it
 * holds open (see sla.pause-reconcile.ts).
 */
export interface PauseLedger {
  pausedAt?: string | null
  pausedSpans?: ExcludedSpan[]
}

/** Milliseconds of [from, until) inside [start, end). */
export function overlapMs(from: number, until: number, start: number, end: number): number {
  return Math.max(0, Math.min(until, end) - Math.max(from, start))
}

/**
 * A clock's deadline as it stood at `at`, to judge a settle at `at`: the
 * stored deadline, without the part of any excluded span after `at` (a
 * reaction that runs late can find later spans already excluded), plus the
 * span held open, up to `at`. Only paused time from `clockStart` on counts:
 * the SLA's application for first response and time-to-close, the cycle's
 * opener for next response.
 */
export function dueAsOf(
  dueAt: string,
  ledger: PauseLedger,
  clockStart: Date | null,
  at: Date
): Date {
  const start = clockStart ? clockStart.getTime() : Number.NEGATIVE_INFINITY
  let due = new Date(dueAt).getTime()
  for (const span of ledger.pausedSpans ?? []) {
    due -= overlapMs(
      new Date(span.from).getTime(),
      new Date(span.until).getTime(),
      Math.max(start, at.getTime()),
      Number.POSITIVE_INFINITY
    )
  }
  if (ledger.pausedAt) {
    due += overlapMs(new Date(ledger.pausedAt).getTime(), at.getTime(), start, at.getTime())
  }
  return new Date(due)
}

/**
 * The stored deadline for a clock armed now with an unshifted `base` deadline
 * and starting at `clockStart`: every span the stamp has already excluded,
 * from `clockStart` on, is added, as it would have been had the clock been
 * running when that span was excluded.
 */
export function withExcludedSpans(base: Date, ledger: PauseLedger, clockStart: Date): Date {
  let due = base.getTime()
  for (const span of ledger.pausedSpans ?? []) {
    due += overlapMs(
      new Date(span.from).getTime(),
      new Date(span.until).getTime(),
      clockStart.getTime(),
      Number.POSITIVE_INFINITY
    )
  }
  return new Date(due)
}
