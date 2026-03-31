import { cn } from '@/lib/shared/utils'

export type MetricKey = 'posts' | 'votes' | 'comments' | 'users'

export const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: 'posts', label: 'Posts', color: 'var(--chart-1)' },
  { key: 'votes', label: 'Votes', color: 'var(--chart-2)' },
  { key: 'comments', label: 'Comments', color: 'var(--chart-3)' },
  { key: 'users', label: 'Users', color: 'var(--chart-4)' },
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
    <div className="flex divide-x divide-border/50">
      {METRICS.map(({ key, label, color }) => {
        const { total } = summary[key]
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
                ? { backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)` }
                : undefined
            }
          >
            <p className="mb-2 text-[10px] font-medium tracking-widest uppercase text-muted-foreground">
              {label}
            </p>
            <p className="text-[2rem] leading-none font-semibold tabular-nums tracking-tight">
              {total.toLocaleString()}
            </p>
            {/* Active indicator */}
            <div
              className={cn(
                'absolute bottom-0 left-0 right-0 h-[3px] transition-opacity duration-150',
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
