import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { analyticsQueries, type AnalyticsPeriod } from '@/lib/client/queries/analytics'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PageHeader } from '@/components/shared/page-header'
import { FilterSection } from '@/components/shared/filter-section'
import { cn } from '@/lib/shared/utils'
import { ChartBarIcon, FunnelIcon, CalendarDaysIcon } from '@heroicons/react/24/solid'
import { CHART_HEIGHT_CLASS } from './analytics-constants'
import { SECTION_NAV_ITEMS, type Section } from './analytics-sections'
import { AnalyticsSectionSelect } from './analytics-section-select'
import { AnalyticsSummaryCards, type MetricKey } from './analytics-summary-cards'
import { AnalyticsVisitorCards, type VisitorMetricKey } from './analytics-visitor-cards'
import { AnalyticsVisitorPanels } from './analytics-visitor-panels'
import { AnalyticsStatRow, type AnalyticsStatProps } from './analytics-stat-row'
import { AnalyticsEmpty } from './analytics-empty'
import { AnalyticsBoardChart } from './analytics-board-chart'
import { AnalyticsChangelogCard } from './analytics-changelog-card'
import { AnalyticsTopPosts } from './analytics-top-posts'
import { AnalyticsTopContributors } from './analytics-top-contributors'
import { AnalyticsSignupSources } from './analytics-signup-sources'
import { AnalyticsCsatDistribution } from './analytics-csat-card'
import { ChartSkeleton, StatusChartSkeleton, SectionSkeleton } from './analytics-skeletons'

// Defer recharts (~580KB minified, including victory-vendor) and the chart
// primitives that wrap it. Analytics is admin-gated and rarely the first
// page hit, so SSR doesn't need recharts in the server bundle.
const AnalyticsActivityChart = lazy(() =>
  import('./analytics-activity-chart').then((m) => ({ default: m.AnalyticsActivityChart }))
)
const AnalyticsStatusChart = lazy(() =>
  import('./analytics-status-chart').then((m) => ({ default: m.AnalyticsStatusChart }))
)
const AnalyticsVisitorChart = lazy(() =>
  import('./analytics-visitor-chart').then((m) => ({ default: m.AnalyticsVisitorChart }))
)

/** A section card matching the Overview: a divided headline stat row, then the
 *  section's visual beneath a hairline divider. */
function StatSection({ stats, children }: { stats: AnalyticsStatProps[]; children: ReactNode }) {
  return (
    <Card className="overflow-hidden py-0 gap-0">
      <AnalyticsStatRow stats={stats} />
      <div className="border-t border-border/50 px-6 py-6">{children}</div>
    </Card>
  )
}

/** Integer average, guarding divide-by-zero, with thousands separators. */
function avgPerItem(total: number, count: number): string {
  return count > 0 ? Math.round(total / count).toLocaleString() : '0'
}

/** Format a median resolution time (in days) as a stat value + unit suffix.
 *  null (nothing resolved in the period) renders as an em dash. */
function formatResolveTime(days: number | null): { value: string; suffix?: string } {
  if (days == null) return { value: '—' }
  if (days < 1) return { value: '<1', suffix: 'day' }
  return { value: days < 10 ? days.toFixed(1) : Math.round(days).toString(), suffix: 'days' }
}

const periods: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
]

export function AnalyticsPage() {
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  // Flag-gated sections: Support reports CSAT (Support Inbox flag), Visitors
  // reports pageview analytics (Visitor Analytics flag) — same gates as the
  // features themselves.
  const sections = SECTION_NAV_ITEMS.filter(
    (i) =>
      (i.key !== 'support' || (flags?.supportInbox ?? false)) &&
      (i.key !== 'visitors' || (flags?.visitorAnalytics ?? false))
  )

  const [period, setPeriod] = useState<AnalyticsPeriod>('30d')
  const [section, setSection] = useState<Section>('overview')
  const [activeMetric, setActiveMetric] = useState<MetricKey>('posts')
  const [visitorMetric, setVisitorMetric] = useState<VisitorMetricKey>('visitors')
  const [surface, setSurface] = useState<'all' | 'portal' | 'widget'>('all')

  const { data, isLoading } = useQuery({
    ...analyticsQueries.data(period),
    placeholderData: keepPreviousData,
  })
  const { data: visitorData, isLoading: visitorLoading } = useQuery({
    ...analyticsQueries.visitors(period, surface),
    placeholderData: keepPreviousData,
    enabled: (flags?.visitorAnalytics ?? false) && section === 'visitors',
  })

  return (
    <div className="flex h-full bg-background">
      {/* Left sidebar */}
      <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border/50 bg-card/30 overflow-hidden">
        <div className="shrink-0 px-4 py-3.5">
          <PageHeader icon={ChartBarIcon} title="Analytics" />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 pb-5">
            <FilterSection title="Sections" collapsible={false}>
              <div className="space-y-1">
                {sections.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSection(key)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                      section === key
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <Icon
                      className={cn('h-3.5 w-3.5 shrink-0', section === key && 'text-primary')}
                    />
                    {label}
                  </button>
                ))}
              </div>
            </FilterSection>
          </div>
        </ScrollArea>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="w-full px-6 pt-4 pb-6 flex flex-col gap-4">
            {/* Header: mobile title + section switcher (left) · updated + period (right) */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 lg:hidden">
                <h1 className="text-base font-semibold">Analytics</h1>
                <AnalyticsSectionSelect items={sections} value={section} onChange={setSection} />
              </div>
              <div className="ml-auto flex items-center gap-3">
                {data?.computedAt && (
                  <p className="hidden text-sm text-muted-foreground sm:block">
                    Updated {formatDistanceToNow(new Date(data.computedAt), { addSuffix: true })}
                  </p>
                )}
                {/* Available filters for the active section (surface, today);
                    hidden when the section has none. */}
                {section === 'visitors' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="relative px-2.5">
                        <FunnelIcon className="h-4 w-4" />
                        {surface !== 'all' && (
                          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
                        )}
                        <span className="sr-only">Filters</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuLabel>Surface</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={surface}
                        onValueChange={(value) => setSurface(value as typeof surface)}
                      >
                        <DropdownMenuRadioItem value="all">All surfaces</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="portal">Portal</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="widget">Widget</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <CalendarDaysIcon className="h-4 w-4" />
                      {periods.find((p) => p.value === period)?.label}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuRadioGroup
                      value={period}
                      onValueChange={(value) => setPeriod(value as AnalyticsPeriod)}
                    >
                      {periods.map(({ value, label }) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {isLoading ? (
              <SectionSkeleton section={section} />
            ) : !data ? null : (
              <>
                {section === 'overview' && (
                  <Card className="overflow-hidden py-0 gap-0">
                    <AnalyticsSummaryCards
                      summary={data.summary}
                      activeMetric={activeMetric}
                      onMetricChange={setActiveMetric}
                    />
                    <div className="border-t border-border/50 px-6 pt-7 pb-6">
                      <Suspense fallback={<ChartSkeleton className={CHART_HEIGHT_CLASS} />}>
                        <AnalyticsActivityChart
                          dailyStats={data.dailyStats}
                          activeMetric={activeMetric}
                        />
                      </Suspense>
                    </div>
                  </Card>
                )}

                {section === 'visitors' &&
                  (visitorLoading || !visitorData ? (
                    <SectionSkeleton section="overview" />
                  ) : !visitorData.enabled ? (
                    <Card className="overflow-hidden">
                      <AnalyticsEmpty message="Visitor analytics is turned off" />
                    </Card>
                  ) : (
                    <div className="flex flex-col gap-6">
                      <Card className="overflow-hidden py-0 gap-0">
                        <AnalyticsVisitorCards
                          totals={{
                            visitors: visitorData.uniqueVisitors,
                            pageviews: visitorData.pageviews,
                            visits: visitorData.visits,
                          }}
                          activeMetric={visitorMetric}
                          onMetricChange={setVisitorMetric}
                        />
                        <div className="border-t border-border/50 px-6 pt-7 pb-6">
                          <Suspense fallback={<ChartSkeleton className={CHART_HEIGHT_CLASS} />}>
                            <AnalyticsVisitorChart
                              dailyStats={visitorData.dailyStats}
                              activeMetric={visitorMetric}
                            />
                          </Suspense>
                        </div>
                      </Card>
                      <AnalyticsVisitorPanels top={visitorData.top} />
                    </div>
                  ))}

                {section === 'feedback' && (
                  <div className="flex flex-col gap-6">
                    <StatSection
                      stats={[
                        {
                          label: 'Posts',
                          value: data.summary.posts.total.toLocaleString(),
                          delta: data.summary.posts.delta,
                        },
                        {
                          label: 'Resolved',
                          value: `${data.resolutionRate}%`,
                          caption: 'current',
                        },
                        {
                          label: 'Median resolve',
                          ...formatResolveTime(data.medianResolutionDays),
                        },
                        {
                          label: 'Followers',
                          value: data.followers.toLocaleString(),
                          caption: 'current',
                        },
                      ]}
                    >
                      <Suspense fallback={<StatusChartSkeleton />}>
                        <AnalyticsStatusChart data={data.statusDistribution} />
                      </Suspense>
                    </StatSection>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
                      <Card>
                        <CardHeader>
                          <CardTitle>Boards</CardTitle>
                        </CardHeader>
                        <CardContent className="max-h-[320px] overflow-y-auto scrollbar-thin">
                          <AnalyticsBoardChart data={data.boardBreakdown} />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Top posts</CardTitle>
                        </CardHeader>
                        <CardContent className="max-h-[320px] overflow-y-auto scrollbar-thin">
                          <AnalyticsTopPosts posts={data.topPosts} />
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}

                {section === 'support' &&
                  (data.csat.responseCount === 0 ? (
                    <Card className="overflow-hidden">
                      <AnalyticsEmpty message="No CSAT responses for this period" />
                    </Card>
                  ) : (
                    <StatSection
                      stats={[
                        {
                          label: 'Avg rating',
                          value: data.csat.avgRating.toFixed(1),
                          suffix: '/ 5',
                          delta: data.csat.avgRatingDelta,
                        },
                        { label: 'Responses', value: data.csat.responseCount.toLocaleString() },
                        { label: 'Response rate', value: `${data.csat.responseRate}%` },
                      ]}
                    >
                      <AnalyticsCsatDistribution distribution={data.csat.distribution} />
                    </StatSection>
                  ))}

                {section === 'changelog' && (
                  <StatSection
                    stats={[
                      {
                        label: 'Published',
                        value: data.changelog.publishedInPeriod.toLocaleString(),
                      },
                      {
                        label: 'Total views',
                        value: data.changelog.totalViews.toLocaleString(),
                        caption: 'all time',
                      },
                      {
                        label: 'Avg / entry',
                        value: avgPerItem(data.changelog.totalViews, data.changelog.publishedCount),
                        caption: 'all time',
                      },
                    ]}
                  >
                    <AnalyticsChangelogCard topEntries={data.changelog.topEntries} />
                  </StatSection>
                )}

                {section === 'users' && (
                  <div className="flex flex-col gap-6">
                    <StatSection
                      stats={[
                        {
                          label: 'Signups',
                          value: data.summary.users.total.toLocaleString(),
                          delta: data.summary.users.delta,
                        },
                        {
                          label: 'New leads',
                          value: data.newLeads.total.toLocaleString(),
                          delta: data.newLeads.delta,
                        },
                        { label: 'Active users', value: data.activeUsers.toLocaleString() },
                        { label: 'Verified', value: `${data.verifiedRate}%`, caption: 'all time' },
                        { label: 'Contributors', value: data.contributorCount.toLocaleString() },
                      ]}
                    >
                      <AnalyticsTopContributors contributors={data.topContributors} />
                    </StatSection>
                    <Card>
                      <CardHeader>
                        <CardTitle>Signups by source</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <AnalyticsSignupSources sources={data.signupsBySource} />
                      </CardContent>
                    </Card>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
