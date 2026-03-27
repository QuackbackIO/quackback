import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'

interface ActivityChartProps {
  dailyStats: Array<{ date: string; posts: number; votes: number; comments: number }>
}

const chartConfig = {
  posts: { label: 'Posts', color: 'hsl(var(--chart-1))' },
  votes: { label: 'Votes', color: 'hsl(var(--chart-2))' },
  comments: { label: 'Comments', color: 'hsl(var(--chart-3))' },
} satisfies ChartConfig

function formatDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function AnalyticsActivityChart({ dailyStats }: ActivityChartProps) {
  if (dailyStats.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
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
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="posts"
          stroke="var(--color-posts)"
          fill="var(--color-posts)"
          fillOpacity={0.15}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="votes"
          stroke="var(--color-votes)"
          fill="var(--color-votes)"
          fillOpacity={0.12}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="comments"
          stroke="var(--color-comments)"
          fill="var(--color-comments)"
          fillOpacity={0.1}
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}
