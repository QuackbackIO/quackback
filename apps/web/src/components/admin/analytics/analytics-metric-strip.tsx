import { cn } from '@/lib/shared/utils'
import { TrendDelta } from './analytics-trend'

export interface MetricStripItem {
  key: string
  label: string
  color: string
  value: number
  /** null hides the trend line (no previous window to compare against). */
  delta: number | null
}

interface AnalyticsMetricStripProps {
  items: MetricStripItem[]
  activeKey: string
  onChange: (key: string) => void
  /** Column layout, e.g. 'grid-cols-3' or 'grid-cols-2 lg:grid-cols-4'. */
  gridClassName: string
}

/** The stat-card strip that doubles as chart tabs: each card shows a metric's
 *  total + trend, and the active card drives the time series below it. */
export function AnalyticsMetricStrip({
  items,
  activeKey,
  onChange,
  gridClassName,
}: AnalyticsMetricStripProps) {
  return (
    <div className={cn('grid divide-border/50', gridClassName)}>
      {items.map(({ key, label, color, value, delta }) => {
        const isActive = activeKey === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
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
              {value.toLocaleString()}
            </p>
            {delta !== null && <TrendDelta value={delta} className="mt-1.5" />}
            {/* Active indicator — full-strength metric color, clearly visible */}
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
