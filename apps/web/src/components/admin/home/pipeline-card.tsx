import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'

const DEFAULT_COLOR = '#6b7280'

interface PipelineStatus {
  label: string
  slug: string
  color: string | null
  category: string | null
  count: number
}

export function PipelineCard({ statuses }: { statuses: PipelineStatus[] }) {
  const maxCount = Math.max(...statuses.map((s) => s.count), 1)
  const totalCount = statuses.reduce((sum, s) => sum + s.count, 0)

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
      style={{ animationDelay: '320ms' }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Pipeline</CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">{totalCount} posts</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {statuses.map((status) => {
            const color = status.color || DEFAULT_COLOR
            const widthPct = (status.count / maxCount) * 100
            return (
              <Link
                key={status.slug}
                to="/admin/feedback"
                search={{ status: [status.slug] }}
                className="block space-y-1 hover:bg-muted/30 -mx-2 px-2 py-1 rounded-md transition-colors"
              >
                <div className="flex items-center justify-between text-sm">
                  <StatusBadge name={status.label} color={status.color} />
                  <span className="font-medium tabular-nums">{status.count}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${widthPct}%`, backgroundColor: color }}
                  />
                </div>
              </Link>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
