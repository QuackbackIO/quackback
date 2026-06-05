/** The 1-5 CSAT rating distribution as proportional bars. The headline numbers
 *  (avg rating, responses, response rate) are rendered by the section's stat
 *  row; this is the visual that sits beneath it. */
export function AnalyticsCsatDistribution({
  distribution,
}: {
  /** Counts for ratings 1..5, index 0 = rating 1. */
  distribution: [number, number, number, number, number]
}) {
  const maxCount = Math.max(1, ...distribution)

  return (
    <div className="flex flex-col gap-1.5">
      {/* Highest rating first so the chart reads top-down 5★ → 1★. */}
      {[5, 4, 3, 2, 1].map((rating) => {
        const count = distribution[rating - 1]
        const pct = Math.round((count / maxCount) * 100)
        return (
          <div key={rating} className="flex items-center gap-2 text-xs">
            <span className="w-7 shrink-0 text-right text-muted-foreground">{rating}★</span>
            <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/40">
              <div
                className="h-full rounded-sm bg-primary/70"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <span className="w-8 shrink-0 text-right font-medium tabular-nums">{count}</span>
          </div>
        )
      })}
    </div>
  )
}
