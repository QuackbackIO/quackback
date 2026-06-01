import { cn } from '@/lib/shared/utils'

interface CsatData {
  avgRating: number
  avgRatingDelta: number
  responseCount: number
  responseRate: number
  /** Counts for ratings 1..5, index 0 = rating 1. */
  distribution: [number, number, number, number, number]
}

/** Three headline numbers + the 1-5 rating distribution as proportional bars. */
export function AnalyticsCsatCard({ csat }: { csat: CsatData }) {
  const { avgRating, avgRatingDelta, responseCount, responseRate, distribution } = csat
  const maxCount = Math.max(1, ...distribution)

  if (responseCount === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No CSAT responses for this period
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 divide-x divide-border/50">
        <Stat label="Avg rating" value={avgRating.toFixed(1)} suffix="/ 5" delta={avgRatingDelta} />
        <Stat label="Responses" value={responseCount.toLocaleString()} />
        <Stat label="Response rate" value={`${responseRate}%`} />
      </div>

      <div className="flex flex-col gap-1.5">
        {/* Highest rating first so the bar chart reads top-down 5★ → 1★. */}
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
    </div>
  )
}

function Stat({
  label,
  value,
  suffix,
  delta,
}: {
  label: string
  value: string
  suffix?: string
  delta?: number
}) {
  return (
    <div className="px-4 first:pl-0">
      <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="flex items-baseline gap-1 text-2xl font-bold tabular-nums leading-none">
        {value}
        {suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
      </p>
      {delta !== undefined && delta !== 0 && (
        <p
          className={cn(
            'mt-1 text-xs font-medium',
            delta > 0 ? 'text-emerald-600' : 'text-red-600'
          )}
        >
          {delta > 0 ? '+' : ''}
          {delta}% vs prev
        </p>
      )}
    </div>
  )
}
