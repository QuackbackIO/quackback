import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { MetricKey } from './analytics-summary-cards'

interface ActivityChartProps {
  dailyStats: Array<{ date: string; posts: number; votes: number; comments: number; users: number }>
  activeMetric: MetricKey
  color: string
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function AnalyticsActivityChart({ dailyStats, activeMetric, color }: ActivityChartProps) {
  const chartConfig: ChartConfig = {
    // Capitalize the metric key so the tooltip reads "Posts", not "posts".
    [activeMetric]: { label: activeMetric[0].toUpperCase() + activeMetric.slice(1), color },
  }

  if (dailyStats.length === 0) {
    return (
      <div className="flex h-[clamp(300px,46vh,520px)] items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <ChartContainer
      key={activeMetric}
      config={chartConfig}
      className="aspect-auto h-[clamp(300px,46vh,520px)] w-full"
    >
      <AreaChart data={dailyStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`fill-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${activeMetric})`} stopOpacity={0.28} />
            <stop offset="100%" stopColor={`var(--color-${activeMetric})`} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickFormatter={formatDate}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          width={32}
          domain={[0, (dataMax: number) => Math.max(dataMax, 4)]}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(label) => formatDate(String(label))} />}
        />
        <Area
          type="monotone"
          dataKey={activeMetric}
          stroke={`var(--color-${activeMetric})`}
          fill={`url(#fill-${activeMetric})`}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
