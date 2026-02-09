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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Pipeline</CardTitle>
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
                <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${widthPct}%`, backgroundColor: color, opacity: 0.6 }}
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
