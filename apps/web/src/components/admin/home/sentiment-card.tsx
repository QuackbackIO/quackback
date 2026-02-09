import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'
import type { SentimentBreakdown } from '@/lib/server/domains/sentiment'

interface SentimentData {
  current: SentimentBreakdown
  previous: SentimentBreakdown
}

const sentimentConfig = [
  { key: 'positive' as const, label: 'Positive', color: 'bg-green-500', dot: 'bg-green-500' },
  { key: 'neutral' as const, label: 'Neutral', color: 'bg-yellow-500', dot: 'bg-yellow-500' },
  { key: 'negative' as const, label: 'Negative', color: 'bg-red-500', dot: 'bg-red-500' },
]

export function SentimentCard({ data }: { data: SentimentData }) {
  const { current, previous } = data
  const hasData = current.total > 0

  if (!hasData) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Sentiment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sentiment analysis runs automatically on new posts.
          </p>
        </CardContent>
      </Card>
    )
  }

  // current.total is guaranteed > 0 after the early return above
  const currentPositivePct = Math.round((current.positive / current.total) * 100)
  const prevPositivePct =
    previous.total > 0 ? Math.round((previous.positive / previous.total) * 100) : 0
  const positiveDelta = currentPositivePct - prevPositivePct

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Sentiment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sentimentConfig.map(({ key, label, color, dot }) => {
            const pct = Math.round((current[key] / current.total) * 100)
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className={cn('h-2 w-2 rounded-full', dot)} />
                    {label}
                  </span>
                  <span className="font-medium tabular-nums">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {previous.total > 0 && positiveDelta !== 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Positive sentiment{' '}
            <span
              className={cn(
                'font-medium',
                positiveDelta > 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              )}
            >
              {positiveDelta > 0 ? '\u25B2' : '\u25BC'} {Math.abs(positiveDelta)}% positive
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
