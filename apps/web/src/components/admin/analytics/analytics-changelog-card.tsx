interface ChangelogCardProps {
  topEntries: Array<{ id: string; title: string; viewCount: number }>
  totalViews: number
}

export function AnalyticsChangelogCard({ topEntries, totalViews }: ChangelogCardProps) {
  if (topEntries.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No changelog entries yet
      </div>
    )
  }

  const maxViews = Math.max(...topEntries.map((e) => e.viewCount), 1)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
        <span>Entry</span>
        <span>Views</span>
      </div>
      <div className="flex flex-col">
        {topEntries.map((entry) => {
          const pct = (entry.viewCount / maxViews) * 100
          return (
            <div key={entry.id} className="relative flex items-center overflow-hidden py-2">
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-foreground/[0.06]"
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex-1 truncate px-1 text-sm">{entry.title}</span>
              <span className="relative ml-4 shrink-0 tabular-nums text-sm text-muted-foreground">
                {entry.viewCount.toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-right text-xs text-muted-foreground">
        {totalViews.toLocaleString()} total views
      </p>
    </div>
  )
}
