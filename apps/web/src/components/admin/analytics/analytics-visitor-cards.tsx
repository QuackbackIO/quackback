import { cn } from '@/lib/shared/utils'
import { TrendDelta } from './analytics-trend'

export type VisitorMetricKey = 'visitors' | 'pageviews' | 'visits'

export const VISITOR_METRICS: Array<{ key: VisitorMetricKey; label: string; color: string }> = [
  { key: 'visitors', label: 'Unique visitors', color: 'var(--metric-visitors)' },
  { key: 'pageviews', label: 'Pageviews', color: 'var(--metric-pageviews)' },
  { key: 'visits', label: 'Visits', color: 'var(--metric-visits)' },
]

interface VisitorCardsProps {
  totals: Record<VisitorMetricKey, { current: number; delta: number | null }>
  activeMetric: VisitorMetricKey
  onMetricChange: (key: VisitorMetricKey) => void
}

/** The visitor metric strip: stat cards that act as tabs for the time series,
 *  same interaction as the Overview summary cards. */
export function AnalyticsVisitorCards({ totals, activeMetric, onMetricChange }: VisitorCardsProps) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border/50">
      {VISITOR_METRICS.map(({ key, label, color }) => {
        const { current, delta } = totals[key]
        const isActive = activeMetric === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onMetricChange(key)}
            className={cn(
              'group relative flex-1 px-5 py-4 text-left transition-colors duration-150',
              !isActive && 'hover:bg-muted/20'
            )}
            style={
              isActive
                ? { backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }
                : undefined
            }
          >
            <p
              className="mb-2 text-xs uppercase tracking-wider text-muted-foreground"
              style={isActive ? { color } : undefined}
            >
              {label}
            </p>
            <p className="text-2xl sm:text-3xl leading-none font-bold tabular-nums tracking-tight">
              {current.toLocaleString()}
            </p>
            {delta !== null && <TrendDelta value={delta} className="mt-1.5" />}
            <div
              className={cn(
                'absolute inset-x-0 bottom-0 h-[3px] transition-opacity duration-150',
                isActive ? 'opacity-100' : 'opacity-0'
              )}
              style={{ background: color }}
            />
          </button>
        )
      })}
    </div>
  )
}
