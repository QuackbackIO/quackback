import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { cn } from '@/lib/shared/utils'
import { CHART_HEIGHT_CLASS } from './analytics-constants'
import type { VisitorMetricKey } from './analytics-visitor-cards'

interface VisitorChartProps {
  dailyStats: Array<{ date: string; uniqueVisitors: number; pageviews: number; visits: number }>
  activeMetric: VisitorMetricKey
}

const METRIC_LABELS: Record<VisitorMetricKey, string> = {
  visitors: 'Unique visitors',
  pageviews: 'Pageviews',
  visits: 'Visits',
}

const METRIC_DATA_KEYS: Record<VisitorMetricKey, 'uniqueVisitors' | 'pageviews' | 'visits'> = {
  visitors: 'uniqueVisitors',
  pageviews: 'pageviews',
  visits: 'visits',
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function AnalyticsVisitorChart({ dailyStats, activeMetric }: VisitorChartProps) {
  const dataKey = METRIC_DATA_KEYS[activeMetric]
  const chartConfig: ChartConfig = {
    [dataKey]: {
      label: METRIC_LABELS[activeMetric],
      color: `var(--metric-${activeMetric})`,
    },
  }

  if (dailyStats.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center text-sm text-muted-foreground',
          CHART_HEIGHT_CLASS
        )}
      >
        No data for this period
      </div>
    )
  }

  return (
    <ChartContainer
      key={activeMetric}
      config={chartConfig}
      className={cn('aspect-auto w-full', CHART_HEIGHT_CLASS)}
    >
      <AreaChart data={dailyStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`fill-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.28} />
            <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.02} />
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
          dataKey={dataKey}
          stroke={`var(--color-${dataKey})`}
          fill={`url(#fill-${activeMetric})`}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
