/**
 * Pure time-to-close aggregation for the support analytics panel.
 * Kept separate from the SQL so the bucketing (per-UTC-day x median, null-filled
 * across the whole period) is unit-tested directly. Conversation volume is low,
 * so the caller selects one row per conversation closed in the period with a
 * plain query and hands them here — no rollup table needed.
 *
 * A row is a conversation that reached a terminal status (conversations.resolved_at
 * set). Close time = resolved_at - created_at. The day bucket is the CLOSE day, so
 * a day reads as "conversations closed that day had been open this long" — an
 * arrival-day bucket would hide resolutions of older backlog entirely.
 */

export interface TimeToCloseRow {
  /** Conversation arrival (conversations.created_at). */
  createdAt: string | Date
  /** Terminal-status timestamp (conversations.closed_at). */
  closedAt: string | Date
}

export interface TimeToCloseDay {
  date: string
  /** Median minutes-to-close for conversations closed that day; null when
   *  nothing closed — the chart gaps those days rather than dipping to zero. */
  medianMinutes: number | null
}

export interface TimeToClose {
  /** One row per UTC day in [start, end], ascending. */
  days: TimeToCloseDay[]
  /** Period-wide median minutes; null when nothing closed. */
  medianMinutes: number | null
  /** Conversations closed in the period. */
  closed: number
}

const toIsoDay = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

/** Continuous median (percentile_cont semantics): the two middle values of an
 *  even sample average rather than picking one. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function buildTimeToClose(
  rows: TimeToCloseRow[],
  /** Inclusive range bounds as ISO date-only strings (YYYY-MM-DD). */
  start: string,
  end: string
): TimeToClose {
  const minutesByDay = new Map<string, number[]>()
  const allMinutes: number[] = []

  for (const r of rows) {
    const date = toIsoDay(r.closedAt)
    if (date < start || date > end) continue
    const minutes = (new Date(r.closedAt).getTime() - new Date(r.createdAt).getTime()) / 60_000
    const bucket = minutesByDay.get(date) ?? []
    bucket.push(minutes)
    minutesByDay.set(date, bucket)
    allMinutes.push(minutes)
  }

  const days: TimeToCloseDay[] = []
  // UTC-day walk keeps the axis continuous across DST and month boundaries.
  for (
    let t = Date.parse(start + 'T00:00:00Z');
    t <= Date.parse(end + 'T00:00:00Z');
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    days.push({ date, medianMinutes: median(minutesByDay.get(date) ?? []) })
  }

  return { days, medianMinutes: median(allMinutes), closed: allMinutes.length }
}
