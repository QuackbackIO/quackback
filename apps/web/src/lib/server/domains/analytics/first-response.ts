/**
 * Pure first-response-time aggregation for the support analytics panel.
 * Kept separate from the SQL so the bucketing (per-UTC-day x median, null-filled
 * across the whole period) is unit-tested directly. Conversation volume is low,
 * so the caller selects one row per responded conversation for the period with a
 * plain query and hands them here — no rollup table needed.
 *
 * A row is a conversation that received at least one agent reply (human or
 * assistant; both post as sender_type 'agent'); conversations still awaiting a
 * first reply never reach this function. The day bucket is the conversation's
 * ARRIVAL day (conversations.created_at), so a day reads as "conversations that
 * arrived that day waited this long for a first reply" — a slow next-morning
 * answer counts against the evening the customer wrote in, not the morning.
 */

export interface FirstResponseRow {
  /** Conversation arrival (conversations.created_at). */
  createdAt: string | Date
  /** Timestamp of the first non-internal agent reply. */
  firstResponseAt: string | Date
}

export interface FirstResponseDay {
  date: string
  /** Median minutes to first response that day; null when no conversation
   *  arrived (or none got answered) — the chart gaps those days rather than
   *  dipping to zero. */
  medianMinutes: number | null
}

export interface FirstResponseTimes {
  /** One row per UTC day in [start, end], ascending. */
  days: FirstResponseDay[]
  /** Period-wide median minutes; null when nothing was answered. */
  medianMinutes: number | null
  /** Conversations in the period that received a first response. */
  responded: number
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

export function buildFirstResponseTimes(
  rows: FirstResponseRow[],
  /** Inclusive range bounds as ISO date-only strings (YYYY-MM-DD). */
  start: string,
  end: string
): FirstResponseTimes {
  const minutesByDay = new Map<string, number[]>()
  const allMinutes: number[] = []

  for (const r of rows) {
    const date = toIsoDay(r.createdAt)
    if (date < start || date > end) continue
    const minutes =
      (new Date(r.firstResponseAt).getTime() - new Date(r.createdAt).getTime()) / 60_000
    const bucket = minutesByDay.get(date) ?? []
    bucket.push(minutes)
    minutesByDay.set(date, bucket)
    allMinutes.push(minutes)
  }

  const days: FirstResponseDay[] = []
  // UTC-day walk keeps the axis continuous across DST and month boundaries.
  for (
    let t = Date.parse(start + 'T00:00:00Z');
    t <= Date.parse(end + 'T00:00:00Z');
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    days.push({ date, medianMinutes: median(minutesByDay.get(date) ?? []) })
  }

  return { days, medianMinutes: median(allMinutes), responded: allMinutes.length }
}
