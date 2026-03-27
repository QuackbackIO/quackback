import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { BarChart, Bar, XAxis, YAxis, Cell } from 'recharts'
import { useMemo } from 'react'

interface StatusChartProps {
  data: Array<{ status: string; color: string; count: number }>
}

export function AnalyticsStatusChart({ data }: StatusChartProps) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])

  const chartConfig = useMemo(() => {
    const config: ChartConfig = {}
    for (const item of sorted) {
      config[item.status] = { label: item.status, color: item.color }
    }
    return config
  }, [sorted])

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
          dataKey="status"
          tickLine={false}
          axisLine={false}
          width={100}
          tickMargin={4}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" radius={4}>
          {sorted.map((entry) => (
            <Cell key={entry.status} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
