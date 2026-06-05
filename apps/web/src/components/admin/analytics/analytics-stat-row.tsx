import { cn } from '@/lib/shared/utils'
import { TrendDelta } from './analytics-trend'

export interface AnalyticsStatProps {
  label: string
  /** Pre-formatted value, e.g. "5.0", "1,204", "67%". */
  value: string
  /** Small trailing unit, e.g. "/ 5". */
  suffix?: string
  /** Period-over-period percent change; omit when not computed. */
  delta?: number
  /**
   * Short temporal-scope note (e.g. "current", "all time") shown in the same
   * line as the delta. Use only for snapshot or all-time stats that sit beside
   * period-scoped ones, to flag that they ignore the period selector. A delta
   * takes precedence when both are set (snapshot stats never carry a delta).
   */
  caption?: string
}

/** A single headline stat, styled to match the Overview metric tiles
 *  (uppercase label, large tabular number) but static — these report, they
 *  don't drive a chart, so there's no hover/active affordance. */
function AnalyticsStat({ label, value, suffix, delta, caption }: AnalyticsStatProps) {
  return (
    <div className="px-5 py-4">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="flex items-baseline gap-1 text-2xl leading-none font-bold tracking-tight tabular-nums sm:text-3xl">
        {value}
        {suffix && <span className="text-base font-medium text-muted-foreground">{suffix}</span>}
      </p>
      {/* The delta line is always present (a delta, a scope caption, or an empty
          spacer) so every stat tile in a row is the same height. */}
      {delta !== undefined ? (
        <TrendDelta value={delta} suffix="vs prev" className="mt-1.5" />
      ) : caption ? (
        <p className="mt-1.5 flex h-4 items-center text-xs leading-none text-muted-foreground">
          {caption}
        </p>
      ) : (
        <div className="mt-1.5 h-4" aria-hidden />
      )}
    </div>
  )
}

const COLS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
}

/** Divided row of headline stats, matching the Overview tile band. Reused as
 *  the header of every analytics section card. */
export function AnalyticsStatRow({ stats }: { stats: AnalyticsStatProps[] }) {
  return (
    <div className={cn('grid divide-x divide-border/50', COLS[stats.length] ?? 'grid-cols-3')}>
      {stats.map((stat) => (
        <AnalyticsStat key={stat.label} {...stat} />
      ))}
    </div>
  )
}
