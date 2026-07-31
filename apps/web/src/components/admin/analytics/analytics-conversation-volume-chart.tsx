import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
import { cn } from '@/lib/shared/utils'
import { CHART_HEIGHT_CLASS, channelColor, channelLabel } from './analytics-constants'
import type { ConversationVolumeDay } from '@/lib/server/domains/analytics/conversation-volume'

interface AnalyticsConversationVolumeChartProps {
  volume: {
    channels: string[]
    days: ConversationVolumeDay[]
  }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** New conversations per day as a stacked area per arrival channel. The stack
 *  order is the server's volume-desc channel order, so the largest channel
 *  forms the base of the stack. */
export function AnalyticsConversationVolumeChart({
  volume,
}: AnalyticsConversationVolumeChartProps) {
  const chartConfig: ChartConfig = Object.fromEntries(
    volume.channels.map((channel, i) => [
      channel,
      { label: channelLabel(channel), color: channelColor(channel, i) },
    ])
  )

  if (volume.channels.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center text-sm text-muted-foreground',
          CHART_HEIGHT_CLASS
        )}
      >
        No conversations for this period
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className={cn('aspect-auto w-full', CHART_HEIGHT_CLASS)}>
      <AreaChart data={volume.days} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
        <ChartLegend content={<ChartLegendContent />} />
        {volume.channels.map((channel) => (
          <Area
            key={channel}
            type="monotone"
            dataKey={channel}
            stackId="conversations"
            stroke={`var(--color-${channel})`}
            fill={`var(--color-${channel})`}
            fillOpacity={0.35}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}
