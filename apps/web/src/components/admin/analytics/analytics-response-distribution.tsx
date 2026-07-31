import type { ResponseDistribution } from '@/lib/server/domains/analytics/response-distribution'

/** First-response wait-time distribution as proportional bars, fastest bucket
 *  first. Reads with the CSAT distribution pattern: a label, a track, a count.
 *  The headline numbers (median, answered) live in the section's stat row. */
export function AnalyticsResponseDistribution({
  distribution,
}: {
  distribution: ResponseDistribution
}) {
  if (distribution.total === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        No responses for this period
      </div>
    )
  }

  const maxCount = Math.max(1, ...distribution.buckets.map((b) => b.count))

  return (
    <div className="flex flex-col gap-1.5">
      {distribution.buckets.map((bucket) => {
        const pct = Math.round((bucket.count / maxCount) * 100)
        const share = Math.round((bucket.count / distribution.total) * 100)
        return (
          <div key={bucket.label} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-right text-muted-foreground">{bucket.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/40">
              <div
                className="h-full rounded-sm bg-primary/70"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <span className="w-8 shrink-0 text-right font-medium tabular-nums">{bucket.count}</span>
            <span className="w-9 shrink-0 text-right text-muted-foreground tabular-nums">
              {share}%
            </span>
          </div>
        )
      })}
    </div>
  )
}
