/**
 * Shared building blocks for the automation performance cards (Quinn
 * performance, workflow/SLA performance): a compact KPI tile, the rolling
 * "last 30 days" range both default to, and the rate-to-percent formatter.
 * `pct` takes a 0-1 rate, matching how SLA attainment is computed; a caller
 * whose source data is already 0-100 (e.g. Quinn's involvement/resolution/
 * escalation rates, or a `ratePctOrNull`-shaped domain field) scales it down
 * with `asRate` first.
 */
import { useMemo } from 'react'

export interface MetricTileProps {
  label: string
  value: string
  sub?: string
}

export function MetricTile({ label, value, sub }: MetricTileProps) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export interface DateRange {
  from: string
  to: string
}

/** The rolling 30-day window the automation performance cards default to. */
export function useLast30DaysRange(): DateRange {
  return useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 86_400_000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [])
}

/** Format a 0-1 rate as a whole-number percent, or a placeholder while unset. */
export function pct(rate: number | null | undefined): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`
}

/** Scale a 0-100 rate down to the 0-1 range `pct` expects; null/undefined pass through unchanged. */
export function asRate(value: number | null | undefined): number | null | undefined {
  return value == null ? value : value / 100
}
