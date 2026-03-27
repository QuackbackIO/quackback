import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'

interface SummaryCardsProps {
  summary: {
    posts: { total: number; delta: number }
    votes: { total: number; delta: number }
    comments: { total: number; delta: number }
    users: { total: number; delta: number }
  }
}

const labels: Array<{ key: keyof SummaryCardsProps['summary']; label: string }> = [
  { key: 'posts', label: 'Posts' },
  { key: 'votes', label: 'Votes' },
  { key: 'comments', label: 'Comments' },
  { key: 'users', label: 'Users' },
]

export function AnalyticsSummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {labels.map(({ key, label }) => {
        const { total, delta } = summary[key]
        return (
          <Card key={key}>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">{label}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight">{total.toLocaleString()}</span>
                <DeltaBadge delta={delta} />
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null

  const isPositive = delta > 0

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium',
        isPositive
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400'
      )}
    >
      {isPositive ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />}
      {Math.abs(delta)}%
    </span>
  )
}
