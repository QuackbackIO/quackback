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
    [activeMetric]: { label: activeMetric, color },
  }

  if (dailyStats.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
      <AreaChart data={dailyStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatDate}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(label) => formatDate(String(label))} />}
        />
        <Area
          key={activeMetric}
          type="monotone"
          dataKey={activeMetric}
          stroke={`var(--color-${activeMetric})`}
          fill={`var(--color-${activeMetric})`}
          fillOpacity={0.12}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}
