import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { PieChart, Pie, Cell } from 'recharts'
import { useMemo } from 'react'

interface StatusChartProps {
  data: Array<{ status: string; color: string; count: number }>
}

export function AnalyticsStatusChart({ data }: StatusChartProps) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])
  const total = useMemo(() => sorted.reduce((sum, d) => sum + d.count, 0), [sorted])

  const chartConfig = useMemo(() => {
    const config: ChartConfig = {}
    for (const item of sorted) {
      config[item.status] = { label: item.status, color: item.color }
    }
    return config
  }, [sorted])

  if (sorted.length === 0 || total === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <div className="flex items-center gap-6 py-2">
      <ChartContainer config={chartConfig} className="h-[180px] w-[180px] shrink-0">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="status" />} />
          <Pie
            data={sorted}
            dataKey="count"
            nameKey="status"
            innerRadius={52}
            outerRadius={80}
            strokeWidth={2}
            stroke="var(--background)"
          >
            {sorted.map((entry) => (
              <Cell key={entry.status} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex flex-1 flex-col gap-2">
        {sorted.map((item) => {
          const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
          return (
            <div key={item.status} className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
              <span className="flex-1 truncate text-muted-foreground">{item.status}</span>
              <span className="font-medium">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
