import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'

interface ActivityData {
  current: { posts: number; votes: number; comments: number }
  previous: { posts: number; votes: number; comments: number }
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return null

  const isUp = pct > 0
  return (
    <span
      className={cn(
        'text-xs font-medium',
        isUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
      )}
    >
      {isUp ? '\u25B2' : '\u25BC'} {Math.abs(pct)}%
    </span>
  )
}

export function ActivityCard({ data }: { data: ActivityData }) {
  const rows = [
    { label: 'New posts', current: data.current.posts, previous: data.previous.posts },
    { label: 'Votes', current: data.current.votes, previous: data.previous.votes },
    { label: 'Comments', current: data.current.comments, previous: data.previous.comments },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/30">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
            >
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{row.current}</span>
                <DeltaBadge current={row.current} previous={row.previous} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
