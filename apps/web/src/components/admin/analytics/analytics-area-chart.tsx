import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { cn } from '@/lib/shared/utils'
import { CHART_HEIGHT_CLASS } from './analytics-constants'

interface AnalyticsAreaChartProps {
  data: Array<Record<string, string | number>>
  /** Row field to plot. */
  dataKey: string
  /** Tooltip label for the series. */
  label: string
  /** Metric token suffix: the series paints with `var(--metric-<metric>)`. */
  metric: string
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The shared daily time-series: one gradient-filled area over a `date` axis.
 *  Both the Overview activity chart and the Visitors chart render through
 *  this; they only differ in which row field and metric token they bind. */
export function AnalyticsAreaChart({ data, dataKey, label, metric }: AnalyticsAreaChartProps) {
  const chartConfig: ChartConfig = {
    // ChartContainer turns this into the `--color-${dataKey}` var the Area
    // and gradient read below.
    [dataKey]: { label, color: `var(--metric-${metric})` },
  }

  if (data.length === 0) {
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
      key={metric}
      config={chartConfig}
      className={cn('aspect-auto w-full', CHART_HEIGHT_CLASS)}
    >
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
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
          fill={`url(#fill-${metric})`}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
