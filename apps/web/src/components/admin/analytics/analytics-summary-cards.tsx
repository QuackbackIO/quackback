import { cn } from '@/lib/shared/utils'
import { TrendDelta } from './analytics-trend'

export type MetricKey = 'posts' | 'votes' | 'comments' | 'users'

export const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: 'posts', label: 'Posts', color: 'var(--metric-posts)' },
  { key: 'votes', label: 'Votes', color: 'var(--metric-votes)' },
  { key: 'comments', label: 'Comments', color: 'var(--metric-comments)' },
  { key: 'users', label: 'Users', color: 'var(--metric-users)' },
]

interface MetricBarProps {
  summary: {
    posts: { total: number; delta: number }
    votes: { total: number; delta: number }
    comments: { total: number; delta: number }
    users: { total: number; delta: number }
  }
  activeMetric: MetricKey
  onMetricChange: (key: MetricKey) => void
}

export function AnalyticsSummaryCards({ summary, activeMetric, onMetricChange }: MetricBarProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border/50">
      {METRICS.map(({ key, label, color }) => {
        const { total, delta } = summary[key]
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
              {total.toLocaleString()}
            </p>
            <TrendDelta value={delta} className="mt-1.5" />
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
