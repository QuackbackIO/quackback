import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { PieChart, Pie, Cell, Label } from 'recharts'
import { useMemo } from 'react'

interface SourceChartProps {
  data: Array<{ source: string; count: number }>
}

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

function labelSource(source: string): string {
  switch (source) {
    case 'portal':
      return 'Portal'
    case 'widget':
      return 'Widget'
    case 'api':
      return 'API'
    default:
      return source.charAt(0).toUpperCase() + source.slice(1)
  }
}

export function AnalyticsSourceChart({ data }: SourceChartProps) {
  const chartData = useMemo(
    () => data.map((d) => ({ ...d, source: labelSource(d.source) })),
    [data]
  )

  const chartConfig = useMemo(() => {
    const config: ChartConfig = {}
    for (let i = 0; i < chartData.length; i++) {
      config[chartData[i].source] = {
        label: chartData[i].source,
        color: COLORS[i % COLORS.length],
      }
    }
    return config
  }, [chartData])

  const total = useMemo(() => chartData.reduce((sum, d) => sum + d.count, 0), [chartData])

  if (chartData.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="source" />} />
        <Pie
          data={chartData}
          dataKey="count"
          nameKey="source"
          innerRadius={60}
          outerRadius={90}
          strokeWidth={2}
          stroke="hsl(var(--background))"
        >
          {chartData.map((entry, index) => (
            <Cell key={entry.source} fill={COLORS[index % COLORS.length]} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground text-2xl font-bold"
                    >
                      {total.toLocaleString()}
                    </tspan>
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 20}
                      className="fill-muted-foreground text-xs"
                    >
                      Total
                    </tspan>
                  </text>
                )
              }
              return null
            }}
          />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="source" />} />
      </PieChart>
    </ChartContainer>
  )
}
