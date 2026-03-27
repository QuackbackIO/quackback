import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { BarChart, Bar, XAxis, YAxis } from 'recharts'
import { useMemo } from 'react'

interface BoardChartProps {
  data: Array<{ board: string; count: number }>
}

const chartConfig = {
  count: { label: 'Posts', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig

export function AnalyticsBoardChart({ data }: BoardChartProps) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])

  if (sorted.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="board"
          tickLine={false}
          axisLine={false}
          width={120}
          tickMargin={4}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
