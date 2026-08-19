import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { cn } from '@/lib/shared/utils'
import { CHART_HEIGHT_CLASS, formatResponseTime } from './analytics-constants'
import type { FirstResponseDay } from '@/lib/server/domains/analytics/first-response'

interface AnalyticsFirstResponseChartProps {
  days: FirstResponseDay[]
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Compact axis variant: whole hours/days only, so ticks stay short. */
function formatAxisMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

const chartConfig: ChartConfig = {
  medianMinutes: { label: 'Median first response', color: 'var(--chart-1)' },
}

/** Median first-response time per day. Days with no answered conversation are
 *  null, so the line gaps instead of dipping to zero — a gap day means "nobody
 *  was answered", not "instant replies". */
export function AnalyticsFirstResponseChart({ days }: AnalyticsFirstResponseChartProps) {
  if (days.every((d) => d.medianMinutes == null)) {
    return (
      <div
        className={cn(
          'flex items-center justify-center text-sm text-muted-foreground',
          CHART_HEIGHT_CLASS
        )}
      >
        No responses for this period
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className={cn('aspect-auto w-full', CHART_HEIGHT_CLASS)}>
      <AreaChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          tickFormatter={formatAxisMinutes}
          width={40}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDate(String(label))}
              formatter={(value) => formatResponseTime(Number(value))}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="medianMinutes"
          stroke="var(--color-medianMinutes)"
          fill="var(--color-medianMinutes)"
          fillOpacity={0.25}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
