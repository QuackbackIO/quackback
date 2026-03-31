import { Avatar } from '@/components/ui/avatar'

interface TopContributorsProps {
  contributors: Array<{
    principalId: string
    displayName: string | null
    avatarUrl: string | null
    posts: number
    votes: number
    comments: number
    total: number
  }>
}

export function AnalyticsTopContributors({ contributors }: TopContributorsProps) {
  if (contributors.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No contributor activity in this period
      </div>
    )
  }

  const maxTotal = Math.max(...contributors.map((c) => c.total), 1)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
        <span>Contributor</span>
        <span>Activity</span>
      </div>
      <div className="flex flex-col">
        {contributors.map((c) => {
          const pct = (c.total / maxTotal) * 100
          return (
            <div
              key={c.principalId}
              className="relative flex items-center gap-2.5 overflow-hidden py-2"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-foreground/[0.06]"
                style={{ width: `${pct}%` }}
              />
              <Avatar
                src={c.avatarUrl}
                name={c.displayName}
                className="relative size-5 shrink-0 text-[10px]"
              />
              <span className="relative flex-1 truncate text-sm">
                {c.displayName ?? 'Anonymous'}
              </span>
              <span className="relative ml-4 shrink-0 tabular-nums text-sm text-muted-foreground">
                {c.total}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
