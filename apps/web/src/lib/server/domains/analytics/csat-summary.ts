/**
 * Pure CSAT aggregation for the support analytics panel. Kept separate from the
 * SQL so the math (mean, distribution, daily trend) is unit-tested directly.
 * Chat/CSAT volume is low, so the caller selects the rated rows for a period
 * with a plain query and hands them here — no materialized view needed.
 */

export interface CsatRatingRow {
  /** 1-5 rating. */
  rating: number
  /** When the rating was submitted (csatSubmittedAt). */
  ratedAt: string | Date
}

export interface CsatSummary {
  /** Mean rating (2dp); 0 when there are no responses. */
  avgRating: number
  responseCount: number
  /** Counts for ratings 1..5, index 0 = rating 1. */
  distribution: [number, number, number, number, number]
  /** Per-UTC-day average + count, ascending by date. */
  dailyTrend: Array<{ date: string; avgRating: number; count: number }>
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function summarizeCsat(rows: CsatRatingRow[]): CsatSummary {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  const byDay = new Map<string, { sum: number; count: number }>()
  let sum = 0
  let responseCount = 0

  for (const r of rows) {
    // Defensive: only count well-formed 1-5 ratings even if a bad row sneaks in.
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) continue
    responseCount++
    sum += r.rating
    distribution[r.rating - 1]++
    const date = new Date(r.ratedAt).toISOString().slice(0, 10)
    const day = byDay.get(date) ?? { sum: 0, count: 0 }
    day.sum += r.rating
    day.count++
    byDay.set(date, day)
  }

  const dailyTrend = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({ date, avgRating: round2(day.sum / day.count), count: day.count }))

  return {
    avgRating: responseCount === 0 ? 0 : round2(sum / responseCount),
    responseCount,
    distribution,
    dailyTrend,
  }
}
