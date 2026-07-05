/**
 * Quinn performance headline (mirrors Fin's Analyze summary): involvement,
 * resolution, and escalation rates over the last 30 days, the
 * confirmed-vs-assumed resolution split, and actions taken via tool calls.
 * Read-only reporting — always visible regardless of the assistantActions
 * flag; gated server-side on analytics.view like the rest of the analytics
 * surface.
 */
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, XAxis } from 'recharts'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { MetricTile, useLast30DaysRange, pct } from './metric-tile'
import { quinnPerformanceQuery } from '@/lib/client/queries/assistant-analytics'

const TREND_CHART_CONFIG: ChartConfig = {
  involvements: { label: 'Involvements', color: 'var(--primary)' },
}

/** Compact daily-involvements trend. Involvement volume is low (like CSAT),
 *  so this rides a live per-day grouping rather than a materialized rollup;
 *  once volume grows, this can move onto a daily rollup like
 *  analyticsDailyStats without changing the card's shape. */
function TrendSparkline({ data }: { data: Array<{ date: string; involvements: number }> }) {
  if (data.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        No data for this period
      </div>
    )
  }
  return (
    <ChartContainer config={TREND_CHART_CONFIG} className="aspect-auto h-20 w-full">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <XAxis dataKey="date" hide />
        <Area
          type="monotone"
          dataKey="involvements"
          stroke="var(--color-involvements)"
          fill="var(--color-involvements)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

/** Quinn's summary rates arrive pre-rounded 0-100 (see QuinnPerformanceSummary); the shared `pct` formatter takes 0-1, so scale down at the call site. */
const asRate = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : value / 100

export function QuinnPerformanceCard() {
  const range = useLast30DaysRange()
  const { data } = useQuery(quinnPerformanceQuery(range.from, range.to))

  return (
    <SettingsCard
      title="Quinn performance"
      description="Involvement, resolution, and escalation over the last 30 days."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          label="Involvement rate"
          value={pct(asRate(data?.involvementRate))}
          sub={data ? `${data.involvements} of ${data.conversations} conversations` : undefined}
        />
        <MetricTile
          label="Resolution rate"
          value={pct(asRate(data?.resolutionRate))}
          sub={
            data ? `${data.resolvedConfirmed} confirmed / ${data.resolvedAssumed} assumed` : undefined
          }
        />
        <MetricTile
          label="Escalation rate"
          value={pct(asRate(data?.escalationRate))}
          sub={data ? `${data.handedOff} handed off` : undefined}
        />
        <MetricTile label="Actions taken" value={data ? String(data.actionsTaken) : '—'} />
      </div>
      <div className="mt-4">
        <TrendSparkline data={data?.dailyTrend ?? []} />
      </div>
    </SettingsCard>
  )
}
