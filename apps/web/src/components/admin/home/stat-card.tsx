import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'

interface StatCardProps {
  label: string
  icon: React.ComponentType<{ className?: string }>
  current: number
  previous: number
  sparkData: number[]
  index?: number
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return null
  const isUp = pct > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-1.5 py-0.5',
        isUp
          ? 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950'
          : 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950'
      )}
    >
      {isUp ? '\u25B2' : '\u25BC'} {Math.abs(pct)}%
    </span>
  )
}

export function StatCard({
  label,
  icon: Icon,
  current,
  previous,
  sparkData,
  index = 0,
}: StatCardProps) {
  const chartData = sparkData.map((value) => ({ value }))
  const trend = current > previous ? 'up' : current < previous ? 'down' : 'neutral'
  const chartColor = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#a1a1aa'
  const gradientId = `fill-${label.replace(/\s+/g, '-')}`

  return (
    <Card
      className="relative overflow-hidden p-4 gap-0 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <DeltaBadge current={current} previous={previous} />
      </div>

      <div className="mt-2 flex items-end justify-between">
        <span className="text-3xl font-bold tabular-nums tracking-tight">{current}</span>
        <div className="h-12 w-24">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}
