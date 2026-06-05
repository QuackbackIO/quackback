import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { useMemo } from 'react'

interface StatusChartProps {
  data: Array<{ status: string; color: string; count: number }>
}

export function AnalyticsStatusChart({ data }: StatusChartProps) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])
  const total = useMemo(() => sorted.reduce((sum, d) => sum + d.count, 0), [sorted])

  if (sorted.length === 0 || total === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <div className="flex items-center gap-6 py-2">
      {/* Fixed-size chart (no ResponsiveContainer) so the donut draws reliably
          when this section is switched in, instead of racing recharts' container
          measurement and rendering at a collapsed size. */}
      <PieChart width={180} height={180} className="shrink-0">
        <Tooltip
          cursor={false}
          content={({ active, payload }) =>
            active && payload && payload.length ? (
              <div className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-md">
                <span className="font-medium">{payload[0]?.name}</span>
                <span className="ml-2 tabular-nums text-muted-foreground">{payload[0]?.value}</span>
              </div>
            ) : null
          }
        />
        <Pie
          data={sorted}
          dataKey="count"
          nameKey="status"
          innerRadius={52}
          outerRadius={80}
          strokeWidth={2}
          stroke="var(--background)"
          // Without this the entrance animation can stall at radius 0 when the
          // chart mounts on a section switch, leaving the donut invisible until
          // a resize. Draw it at full size immediately.
          isAnimationActive={false}
        >
          {sorted.map((entry) => (
            <Cell key={entry.status} fill={entry.color} />
          ))}
        </Pie>
      </PieChart>
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
