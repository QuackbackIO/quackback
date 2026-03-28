import { cn } from '@/lib/shared/utils'

export type MetricKey = 'posts' | 'votes' | 'comments' | 'users'

export const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: 'posts', label: 'Posts', color: 'hsl(var(--chart-1))' },
  { key: 'votes', label: 'Votes', color: 'hsl(var(--chart-2))' },
  { key: 'comments', label: 'Comments', color: 'hsl(var(--chart-3))' },
  { key: 'users', label: 'Users', color: 'hsl(var(--chart-4))' },
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
              'relative flex-1 px-5 py-4 text-left transition-colors',
              isActive ? 'bg-muted/40' : 'hover:bg-muted/20'
            )}
          >
            <p className="mb-1.5 text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tracking-tight">{total.toLocaleString()}</p>
            {isActive && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: color }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
