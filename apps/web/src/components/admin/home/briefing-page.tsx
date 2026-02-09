import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { analyticsQueries } from '@/lib/client/queries/analytics'
import { cn } from '@/lib/shared/utils'
import { TrendingSection } from './trending-section'
import { AttentionSection } from './attention-section'
import { ActivityCard } from './activity-card'
import { SentimentCard } from './sentiment-card'
import { PipelineCard } from './pipeline-card'
import { ResponseHealthCard } from './response-health-card'

type Period = '7d' | '30d' | '90d'

const PERIODS: Period[] = ['7d', '30d', '90d']

export function BriefingPage({ period }: { period: Period }) {
  const navigate = useNavigate()
  const { data } = useSuspenseQuery(analyticsQueries.briefing(period))

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Your Briefing</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Last {period === '7d' ? '7 days' : period === '30d' ? '30 days' : '90 days'} vs
              previous period
            </p>
          </div>
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            {PERIODS.map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'ghost'}
                size="sm"
                className={cn('h-7 px-3 text-xs', period !== p && 'text-muted-foreground')}
                onClick={() => navigate({ to: '/admin', search: { period: p } })}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>

        {/* Trending */}
        <TrendingSection posts={data.trending} />

        {/* Needs Attention */}
        <AttentionSection data={data.attention} />

        {/* Activity + Sentiment (side by side on desktop) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <ActivityCard data={data.activity} />
          <SentimentCard data={data.sentiment} />
        </div>

        {/* Pipeline + Response Health (side by side on desktop) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <PipelineCard statuses={data.pipeline} />
          <ResponseHealthCard data={data.responseHealth} />
        </div>
      </div>
    </div>
  )
}
