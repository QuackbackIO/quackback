import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { analyticsQueries, type AnalyticsPeriod } from '@/lib/client/queries/analytics'
import { formatDistanceToNow } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AnalyticsSummaryCards } from './analytics-summary-cards'
import { AnalyticsActivityChart } from './analytics-activity-chart'
import { AnalyticsStatusChart } from './analytics-status-chart'
import { AnalyticsBoardChart } from './analytics-board-chart'
import { AnalyticsTopPosts } from './analytics-top-posts'
import { AnalyticsTopContributors } from './analytics-top-contributors'

const periods: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '12m', label: '12m' },
]

export function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('30d')

  const { data, isLoading } = useQuery({
    ...analyticsQueries.data(period),
    placeholderData: keepPreviousData,
  })

  if (isLoading || !data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            {data.computedAt && (
              <p className="text-sm text-muted-foreground">
                Last updated {formatDistanceToNow(new Date(data.computedAt), { addSuffix: true })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border/50 p-1">
            {periods.map(({ value, label }) => (
              <Button
                key={value}
                variant={period === value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPeriod(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <AnalyticsSummaryCards summary={data.summary} dailyStats={data.dailyStats} />

        {/* Activity over time */}
        <Card>
          <CardHeader>
            <CardTitle>Activity over time</CardTitle>
          </CardHeader>
          <CardContent>
            <AnalyticsActivityChart dailyStats={data.dailyStats} />
          </CardContent>
        </Card>

        {/* Status + Board */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
              <CardTitle>Board breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <AnalyticsBoardChart data={data.boardBreakdown} />
            </CardContent>
          </Card>
        </div>

        {/* Changelog */}
        <Card>
          <CardHeader>
            <CardTitle>Changelog stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-[250px] flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Total views</p>
              <p className="text-3xl font-bold tracking-tight">
                {data.changelog.totalViews.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Top posts */}
        <Card>
          <CardHeader>
            <CardTitle>Top posts</CardTitle>
          </CardHeader>
          <CardContent>
            <AnalyticsTopPosts posts={data.topPosts} />
          </CardContent>
        </Card>

        {/* Top contributors */}
        <Card>
          <CardHeader>
            <CardTitle>Top contributors</CardTitle>
          </CardHeader>
          <CardContent>
            <AnalyticsTopContributors contributors={data.topContributors} />
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}
