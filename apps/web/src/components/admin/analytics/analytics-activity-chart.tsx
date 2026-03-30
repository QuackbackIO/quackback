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
    <ChartContainer
      key={activeMetric}
      config={chartConfig}
      className="aspect-auto h-[260px] w-full"
    >
      <AreaChart data={dailyStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
          fill={`var(--color-${activeMetric})`}
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
