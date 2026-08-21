/**
 * Quinn performance headline: involvement,
 * resolution, and escalation rates over the last 30 days, the
 * confirmed-vs-assumed resolution split, and actions taken via tool calls.
 * Read-only reporting — gated server-side on analytics.view like the rest
 * of the analytics surface.
 */
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { AreaChart, Area, XAxis } from 'recharts'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { MetricTile, useLast30DaysRange, pct, asRate } from './metric-tile'
import { quinnPerformanceQuery } from '@/lib/client/queries/assistant-analytics'

const TREND_CHART_CONFIG: ChartConfig = {
  involvements: { label: 'Involvements', color: 'var(--primary)' },
}

/** Compact daily-involvements trend. Involvement volume is low (like CSAT),
 *  so this rides a live per-day grouping rather than a materialized rollup;
 *  once volume grows, this can move onto a daily rollup like
 *  analyticsDailyStats without changing the card's shape. */
function TrendSparkline({ data }: { data: Array<{ date: string; involvements: number }> }) {
  const intl = useIntl()
  if (data.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        {intl.formatMessage({
          id: 'automation.performance.noData',
          defaultMessage: 'No data for this period',
        })}
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

export function QuinnPerformanceCard() {
  const intl = useIntl()
  const range = useLast30DaysRange()
  const performanceQuery = useQuery(quinnPerformanceQuery(range.from, range.to))
  const { data } = performanceQuery

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'automation.performance.agent.title',
        defaultMessage: 'AI agent performance',
      })}
      description={intl.formatMessage({
        id: 'automation.performance.agent.description',
        defaultMessage: 'Involvement, resolution, and escalation over the last 30 days.',
      })}
    >
      {performanceQuery.isError ? (
        <div className="flex items-center justify-between gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.performance.agent.error',
              defaultMessage: 'AI agent performance could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void performanceQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.agent.involvement',
                defaultMessage: 'Involvement rate',
              })}
              value={pct(asRate(data?.involvementRate))}
              sub={
                data
                  ? intl.formatMessage(
                      {
                        id: 'automation.performance.agent.involvementDetail',
                        defaultMessage: '{involvements} of {conversations} conversations',
                      },
                      { involvements: data.involvements, conversations: data.conversations }
                    )
                  : undefined
              }
            />
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.agent.resolution',
                defaultMessage: 'Resolution rate',
              })}
              value={pct(asRate(data?.resolutionRate))}
              sub={
                data
                  ? intl.formatMessage(
                      {
                        id: 'automation.performance.agent.resolutionDetail',
                        defaultMessage: '{confirmed} confirmed / {assumed} assumed',
                      },
                      { confirmed: data.resolvedConfirmed, assumed: data.resolvedAssumed }
                    )
                  : undefined
              }
            />
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.agent.escalation',
                defaultMessage: 'Escalation rate',
              })}
              value={pct(asRate(data?.escalationRate))}
              sub={
                data
                  ? intl.formatMessage(
                      {
                        id: 'automation.performance.agent.escalationDetail',
                        defaultMessage: '{count} handed off',
                      },
                      { count: data.handedOff }
                    )
                  : undefined
              }
            />
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.agent.actions',
                defaultMessage: 'Actions completed',
              })}
              value={data ? String(data.actionsTaken) : '—'}
            />
            <MetricTile
              label={intl.formatMessage({
                id: 'automation.performance.agent.csat',
                defaultMessage: 'Customer satisfaction',
              })}
              value={
                data && data.csat.responseCount > 0
                  ? intl.formatMessage(
                      {
                        id: 'automation.performance.agent.csatValue',
                        defaultMessage: '{avg} / 5',
                      },
                      {
                        avg: intl.formatNumber(data.csat.avgRating, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }),
                      }
                    )
                  : '—'
              }
              sub={
                data
                  ? intl.formatMessage(
                      {
                        id: 'automation.performance.agent.csatDetail',
                        defaultMessage: '{count, plural, one {# rating} other {# ratings}}',
                      },
                      { count: data.csat.responseCount }
                    )
                  : undefined
              }
            />
          </div>
          <div className="mt-4">
            <TrendSparkline data={data?.dailyTrend ?? []} />
          </div>
        </>
      )}
    </SettingsCard>
  )
}
