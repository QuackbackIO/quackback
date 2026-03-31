import { useMemo } from 'react'

interface BoardChartProps {
  data: Array<{ board: string; count: number }>
}

export function AnalyticsBoardChart({ data }: BoardChartProps) {
  const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])
  const maxCount = Math.max(...sorted.map((d) => d.count), 1)

  if (sorted.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No data for this period
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
        <span>Board</span>
        <span>Posts</span>
      </div>
      <div className="flex flex-col">
        {sorted.map((item) => {
          const pct = (item.count / maxCount) * 100
          return (
            <div key={item.board} className="relative flex items-center overflow-hidden py-2">
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-foreground/[0.06]"
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex-1 truncate px-1 text-sm">{item.board}</span>
              <span className="relative ml-4 shrink-0 tabular-nums text-sm text-muted-foreground">
                {item.count}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
