import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/shared/utils'

interface ResponseHealthData {
  current: { respondedWithin48h: number; totalInPeriod: number; avgResponseHours: number | null }
  previous: { respondedWithin48h: number; totalInPeriod: number; avgResponseHours: number | null }
}

const TARGET_PCT = 95

export function ResponseHealthCard({ data }: { data: ResponseHealthData }) {
  const { current, previous } = data
  const hasData = current.totalInPeriod > 0

  if (!hasData) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Response Health</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Response metrics appear once your team starts responding to posts.
          </p>
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Response Health</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/30">
          <div className="pb-3">
            <p className="text-sm text-muted-foreground mb-1.5">
              <span className="font-semibold text-foreground">{responsePct}%</span> responded within
              48h
            </p>
            <div className="h-2 rounded-full bg-muted overflow-hidden relative">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  responsePct >= TARGET_PCT ? 'bg-green-500' : 'bg-amber-500'
                )}
                style={{ width: `${responsePct}%` }}
              />
              {/* Target marker */}
              <div
                className="absolute top-0 h-full w-px bg-foreground/30"
                style={{ left: `${TARGET_PCT}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Target: {TARGET_PCT}%</p>
          </div>

          {avgHours != null && (
            <div className="flex items-center justify-between pt-3">
              <span className="text-sm text-muted-foreground">Avg first response</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">
                  {avgHours.toFixed(1)} hrs
                </span>
                {avgDelta != null && avgDelta !== 0 && (
                  <span
                    className={cn(
                      'text-xs font-medium',
                      avgDelta < 0
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {avgDelta < 0 ? '\u25BC' : '\u25B2'} {Math.abs(avgDelta)}%
                    {avgDelta < 0 ? ' faster' : ' slower'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
