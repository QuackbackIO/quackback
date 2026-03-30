import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { analyticsQueries, type AnalyticsPeriod } from '@/lib/client/queries/analytics'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'
import { ChartBarIcon, InboxIcon, DocumentTextIcon, UsersIcon } from '@heroicons/react/24/solid'
import { AnalyticsSummaryCards, METRICS, type MetricKey } from './analytics-summary-cards'
import { AnalyticsActivityChart } from './analytics-activity-chart'
import { AnalyticsStatusChart } from './analytics-status-chart'
import { AnalyticsBoardChart } from './analytics-board-chart'
import { AnalyticsChangelogCard } from './analytics-changelog-card'
import { AnalyticsTopPosts } from './analytics-top-posts'
import { AnalyticsTopContributors } from './analytics-top-contributors'

type Section = 'overview' | 'feedback' | 'changelog' | 'users'

const periods: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '12m', label: '12m' },
]

const navItems: Array<{ key: Section; label: string; icon: React.ElementType }> = [
  { key: 'overview', label: 'Overview', icon: ChartBarIcon },
  { key: 'feedback', label: 'Feedback', icon: InboxIcon },
  { key: 'changelog', label: 'Changelog', icon: DocumentTextIcon },
  { key: 'users', label: 'Users', icon: UsersIcon },
]

export function AnalyticsPage() {
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
        <ScrollArea className="h-full">
          <div className="p-5 space-y-6">
            <div className="space-y-1">
              {navItems.map(({ key, label, icon: Icon }) => (
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
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', section === key && 'text-primary')} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </ScrollArea>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-4xl px-6 pt-4 pb-6 flex flex-col gap-4">
            {/* Header: period selector + last updated */}
            <div className="flex items-center justify-end gap-3">
              {data?.computedAt && (
                <p className="text-sm text-muted-foreground">
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
                      <AnalyticsActivityChart
                        dailyStats={data.dailyStats}
                        activeMetric={activeMetric}
                        color={activeColor}
                      />
                    </div>
                  </Card>
                )}

                {section === 'feedback' && (
                  <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>Status distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <AnalyticsStatusChart data={data.statusDistribution} />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Boards</CardTitle>
                        </CardHeader>
                        <CardContent>
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
      <div className="flex divide-x divide-border/50">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 px-5 py-4">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <div className="border-t border-border/50 px-6 pt-7 pb-6">
        <Skeleton className="h-[280px] w-full rounded-lg" />
      </div>
    </Card>
  )
}
