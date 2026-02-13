import { FaceSmileIcon } from '@heroicons/react/24/outline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'
import type { SentimentBreakdown } from '@/lib/server/domains/sentiment'

interface SentimentData {
  current: SentimentBreakdown
  previous: SentimentBreakdown
}

const sentimentConfig = [
  { key: 'positive' as const, label: 'Positive', color: 'bg-green-500' },
  { key: 'neutral' as const, label: 'Neutral', color: 'bg-yellow-500' },
  { key: 'negative' as const, label: 'Negative', color: 'bg-red-500' },
]

const dotColors = {
  positive: 'bg-green-500',
  neutral: 'bg-yellow-500',
  negative: 'bg-red-500',
}

export function SentimentCard({ data }: { data: SentimentData }) {
  const { current, previous } = data
  const hasData = current.total > 0

  if (!hasData) {
    return (
      <Card
        className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
        style={{ animationDelay: '240ms' }}
      >
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <FaceSmileIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Sentiment analysis is ready</p>
            <p className="text-xs text-muted-foreground mt-1">
              New posts are analyzed automatically
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const percentages = sentimentConfig.map(({ key }) => ({
    key,
    pct: Math.round((current[key] / current.total) * 100),
  }))

  const currentPositivePct = Math.round((current.positive / current.total) * 100)
  const prevPositivePct =
    previous.total > 0 ? Math.round((previous.positive / previous.total) * 100) : 0
  const positiveDelta = currentPositivePct - prevPositivePct

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
      style={{ animationDelay: '240ms' }}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Sentiment</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Stacked horizontal bar */}
        <div className="h-3 rounded-full overflow-hidden flex">
          {sentimentConfig.map(({ key, color }) => {
            const pct = (current[key] / current.total) * 100
            if (pct === 0) return null
            return (
              <div
                key={key}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', color)}
                style={{ width: `${pct}%` }}
              />
            )
          })}
        </div>

        {/* Legend row */}
        <div className="flex items-center gap-4 mt-3">
          {percentages.map(({ key, pct }) => (
            <div key={key} className="flex items-center gap-1.5 text-xs">
              <span className={cn('h-2 w-2 rounded-full', dotColors[key])} />
              <span className="text-muted-foreground capitalize">{key}</span>
              <span className="font-medium tabular-nums">{pct}%</span>
            </div>
          ))}
        </div>

        {/* Delta badge */}
        {previous.total > 0 && positiveDelta !== 0 && (
          <div className="mt-3">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-1.5 py-0.5',
                positiveDelta > 0
                  ? 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950'
                  : 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950'
              )}
            >
              {positiveDelta > 0 ? '\u25B2' : '\u25BC'} {Math.abs(positiveDelta)}% positive
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
