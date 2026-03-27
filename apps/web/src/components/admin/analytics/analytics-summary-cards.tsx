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
  dailyStats: Array<{
    date: string
    posts: number
    votes: number
    comments: number
    users: number
  }>
}

const METRIC_CONFIG = [
  {
    key: 'posts' as const,
    label: 'Posts',
    icon: '📝',
    color: '#6366f1',
    iconBg: 'bg-indigo-500/10',
  },
  {
    key: 'votes' as const,
    label: 'Votes',
    icon: '👍',
    color: '#22c55e',
    iconBg: 'bg-green-500/10',
  },
  {
    key: 'comments' as const,
    label: 'Comments',
    icon: '💬',
    color: '#f59e0b',
    iconBg: 'bg-amber-500/10',
  },
  {
    key: 'users' as const,
    label: 'Users',
    icon: '👤',
    color: '#8b5cf6',
    iconBg: 'bg-violet-500/10',
  },
] as const

export function AnalyticsSummaryCards({ summary, dailyStats }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {METRIC_CONFIG.map(({ key, label, icon, color, iconBg }) => {
        const { total, delta } = summary[key]
        const sparkData = dailyStats.map((d) => d[key])
        return (
          <Card key={key}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-lg text-sm',
                      iconBg
                    )}
                  >
                    {icon}
                  </div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
                <DeltaBadge delta={delta} />
              </div>
              <p className="mt-2 text-3xl font-bold tracking-tight">{total.toLocaleString()}</p>
              <Sparkline data={sparkData} color={color} />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1)
  if (data.length === 0) return null
  return (
    <div className="mt-2 flex h-6 items-end gap-px">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm rounded-b-none"
          style={{
            height: `${Math.max((v / max) * 100, 4)}%`,
            background: color,
            opacity: 0.3 + (i / (data.length - 1)) * 0.6,
          }}
        />
      ))}
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
