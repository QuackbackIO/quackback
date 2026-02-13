import { ClockIcon } from '@heroicons/react/24/outline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'

interface ResponseHealthData {
  current: { respondedWithin48h: number; totalInPeriod: number; avgResponseHours: number | null }
  previous: { respondedWithin48h: number; totalInPeriod: number; avgResponseHours: number | null }
}

const TARGET_PCT = 95

function getHealthColor(pct: number) {
  if (pct >= TARGET_PCT) return 'text-green-600 dark:text-green-400'
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function getBarColor(pct: number) {
  if (pct >= TARGET_PCT) return 'bg-green-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-red-500'
}

export function ResponseHealthCard({ data }: { data: ResponseHealthData }) {
  const { current, previous } = data
  const hasData = current.totalInPeriod > 0

  if (!hasData) {
    return (
      <Card
        className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
        style={{ animationDelay: '400ms' }}
      >
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <ClockIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Start responding to posts</p>
            <p className="text-xs text-muted-foreground mt-1">Track your team's response time</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const responsePct = Math.round((current.respondedWithin48h / current.totalInPeriod) * 100)
  const avgHours = current.avgResponseHours
  const prevAvgHours = previous.avgResponseHours

  let avgDelta: number | null = null
  if (avgHours !== null && prevAvgHours !== null && prevAvgHours > 0) {
    avgDelta = Math.round(((avgHours - prevAvgHours) / prevAvgHours) * 100)
  }

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
      style={{ animationDelay: '400ms' }}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Response Health</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Hero percentage */}
        <div className="flex items-baseline gap-1.5 mb-3">
          <span
            className={cn(
              'text-3xl font-bold tabular-nums tracking-tight',
              getHealthColor(responsePct)
            )}
          >
            {responsePct}%
          </span>
          <span className="text-sm text-muted-foreground">within 48h</span>
        </div>

        {/* Progress bar with target marker */}
        <div className="h-2 rounded-full bg-muted overflow-hidden relative">
          <div
            className={cn('h-full rounded-full transition-all', getBarColor(responsePct))}
            style={{ width: `${responsePct}%` }}
          />
          <div
            className="absolute top-0 h-full w-px bg-foreground/30"
            style={{ left: `${TARGET_PCT}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">Target: {TARGET_PCT}%</p>

        {/* Avg response time */}
        {avgHours != null && (
          <div className="flex items-baseline justify-between mt-4 pt-3 border-t border-border/30">
            <span className="text-sm text-muted-foreground">Avg first response</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold tabular-nums">{avgHours.toFixed(1)}h</span>
              {avgDelta != null && avgDelta !== 0 && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-1.5 py-0.5',
                    avgDelta < 0
                      ? 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-950'
                      : 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950'
                  )}
                >
                  {avgDelta < 0 ? '\u25BC' : '\u25B2'} {Math.abs(avgDelta)}%
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
