import { lazy, Suspense, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { analyticsQueries, type AnalyticsPeriod } from '@/lib/client/queries/analytics'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/page-header'
import { FilterSection } from '@/components/shared/filter-section'
import { cn } from '@/lib/shared/utils'
import { ChartBarIcon } from '@heroicons/react/24/solid'
import { SECTION_NAV_ITEMS, type Section } from './analytics-sections'
import { AnalyticsSectionSelect } from './analytics-section-select'
import { AnalyticsSummaryCards, METRICS, type MetricKey } from './analytics-summary-cards'
import { AnalyticsBoardChart } from './analytics-board-chart'
import { AnalyticsChangelogCard } from './analytics-changelog-card'
import { AnalyticsTopPosts } from './analytics-top-posts'
import { AnalyticsTopContributors } from './analytics-top-contributors'
import { AnalyticsCsatCard } from './analytics-csat-card'

// Defer recharts (~580KB minified, including victory-vendor) and the chart
// primitives that wrap it. Analytics is admin-gated and rarely the first
// page hit, so SSR doesn't need recharts in the server bundle.
const AnalyticsActivityChart = lazy(() =>
  import('./analytics-activity-chart').then((m) => ({ default: m.AnalyticsActivityChart }))
)
const AnalyticsStatusChart = lazy(() =>
  import('./analytics-status-chart').then((m) => ({ default: m.AnalyticsStatusChart }))
)

function ChartSkeleton({ className }: { className?: string }) {
  return <div className={cn('w-full rounded-md bg-muted/50 animate-pulse', className)} />
}

const periods: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '12m', label: '12m' },
]

export function AnalyticsPage() {
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  // The Support section reports CSAT metrics, so hide it unless the experimental
  // Support Inbox flag is on — same gate as the inbox itself.
  const sections = SECTION_NAV_ITEMS.filter(
    (i) => i.key !== 'support' || (flags?.supportInbox ?? false)
  )

  const [period, setPeriod] = useState<AnalyticsPeriod>('30d')
  const [section, setSection] = useState<Section>('overview')
  const [activeMetric, setActiveMetric] = useState<MetricKey>('posts')

  const { data, isLoading } = useQuery({
    ...analyticsQueries.data(period),
    placeholderData: keepPreviousData,
  })

  const activeColor = METRICS.find((m) => m.key === activeMetric)?.color ?? 'var(--chart-1)'

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
          <div className="mx-auto w-full max-w-4xl px-6 pt-4 pb-6 flex flex-col gap-4">
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
                <div className="flex items-center gap-1 rounded-lg border border-border/50 p-1">
                  {periods.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPeriod(value)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        period === value
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {isLoading ? (
              <SectionSkeleton />
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
                      <Suspense
                        fallback={<ChartSkeleton className="h-[clamp(300px,46vh,520px)]" />}
                      >
                        <AnalyticsActivityChart
                          dailyStats={data.dailyStats}
                          activeMetric={activeMetric}
                          color={activeColor}
                        />
                      </Suspense>
                    </div>
                  </Card>
                )}

                {section === 'feedback' && (
                  <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
                      <Card>
                        <CardHeader>
                          <CardTitle>Status distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <Suspense fallback={<ChartSkeleton className="h-[250px]" />}>
                            <AnalyticsStatusChart data={data.statusDistribution} />
                          </Suspense>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Boards</CardTitle>
                        </CardHeader>
                        <CardContent className="max-h-[320px] overflow-y-auto scrollbar-thin">
                          <AnalyticsBoardChart data={data.boardBreakdown} />
                        </CardContent>
                      </Card>
                    </div>
                    <Card>
                      <CardHeader>
                        <CardTitle>Top posts</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <AnalyticsTopPosts posts={data.topPosts} />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {section === 'support' && (
                  <div className="flex flex-col gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Customer satisfaction (CSAT)</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <AnalyticsCsatCard csat={data.csat} />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {section === 'changelog' && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Changelog views</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <AnalyticsChangelogCard
                        topEntries={data.changelog.topEntries}
                        totalViews={data.changelog.totalViews}
                      />
                    </CardContent>
                  </Card>
                )}

                {section === 'users' && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Top contributors</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <AnalyticsTopContributors contributors={data.topContributors} />
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}

function SectionSkeleton() {
  return (
    <Card className="overflow-hidden py-0 gap-0">
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border/50">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-4">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <div className="border-t border-border/50 px-6 pt-7 pb-6">
        <Skeleton className="h-[clamp(300px,46vh,520px)] w-full rounded-lg" />
      </div>
    </Card>
  )
}
