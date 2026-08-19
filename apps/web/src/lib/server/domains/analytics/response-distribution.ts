/**
 * Pure wait-time distribution for the support analytics panel. Buckets the
 * same per-conversation first-response rows the median trend uses into fixed
 * wait-time ranges, so the histogram is unit-tested independently of the SQL.
 * Unanswered conversations never reach this function (the caller's JOIN drops
 * them); rows outside the window are ignored, mirroring first-response.ts.
 *
 * Bucket upper bounds are exclusive on the lower edge and inclusive from the
 * lower edge up: a wait of exactly 5 minutes lands in "5–30m", not "<5m".
 */

import type { FirstResponseRow } from './first-response'

export interface ResponseBucket {
  /** Display label for the wait-time range ("5–30m"). */
  label: string
  /** Conversations whose first response landed in this range. */
  count: number
}

export interface ResponseDistribution {
  /** One entry per bucket, fastest wait first; empty buckets stay at zero so
   *  the histogram axis keeps its shape on sparse data. */
  buckets: ResponseBucket[]
  /** Conversations in the window that received a first response. */
  total: number
}

/** Upper bound of each bucket in minutes; the last bucket is unbounded. */
export const RESPONSE_BUCKETS: ReadonlyArray<{ label: string; maxMinutes: number }> = [
  { label: '<5m', maxMinutes: 5 },
  { label: '5–30m', maxMinutes: 30 },
  { label: '30m–1h', maxMinutes: 60 },
  { label: '1–4h', maxMinutes: 240 },
  { label: '4–24h', maxMinutes: 1440 },
  { label: '1–3d', maxMinutes: 4320 },
  { label: '>3d', maxMinutes: Number.POSITIVE_INFINITY },
]

const toIsoDay = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

export function buildResponseDistribution(
  rows: FirstResponseRow[],
  /** Inclusive range bounds as ISO date-only strings (YYYY-MM-DD), matched on
   *  the conversation's arrival day like the first-response trend. */
  start: string,
  end: string
): ResponseDistribution {
  const counts = RESPONSE_BUCKETS.map(() => 0)
  let total = 0

  for (const r of rows) {
    const date = toIsoDay(r.createdAt)
    if (date < start || date > end) continue
    const minutes =
      (new Date(r.firstResponseAt).getTime() - new Date(r.createdAt).getTime()) / 60_000
    const index = RESPONSE_BUCKETS.findIndex((b) => minutes < b.maxMinutes)
    counts[index] += 1
    total += 1
  }

  return {
    buckets: RESPONSE_BUCKETS.map((b, i) => ({ label: b.label, count: counts[i] })),
    total,
  }
}
