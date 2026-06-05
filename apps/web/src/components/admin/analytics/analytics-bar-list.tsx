import type { ReactNode } from 'react'

export interface BarListRow {
  key: string
  /** Text or a node (e.g. a <Link>); the list truncates it to a single line. */
  label: ReactNode
  /** Drives bar width, relative to the max in the set. */
  value: number
  /** Formatted value text. Defaults to `value.toLocaleString()`. */
  display?: string
  /** Optional leading slot rendered before the label (e.g. an avatar). */
  leading?: ReactNode
}

interface AnalyticsBarListProps {
  header: { label: string; value: string }
  rows: BarListRow[]
}

/** Horizontal "bar behind label" list shared by Boards, Top posts, Changelog,
 *  and Contributors. The faint bar encodes relative magnitude; the label and
 *  value sit on top. */
export function AnalyticsBarList({ header, rows }: AnalyticsBarListProps) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1 text-xs uppercase tracking-wider text-muted-foreground">
        <span>{header.label}</span>
        <span>{header.value}</span>
      </div>
      <div className="flex flex-col">
        {rows.map((row) => {
          const pct = (row.value / max) * 100
          return (
            <div key={row.key} className="relative flex items-center gap-2.5 overflow-hidden py-2">
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-foreground/[0.06]"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              {row.leading}
              <div className="relative min-w-0 flex-1 truncate px-1 text-sm">{row.label}</div>
              <span className="relative ml-4 shrink-0 tabular-nums text-sm text-muted-foreground">
                {row.display ?? row.value.toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
