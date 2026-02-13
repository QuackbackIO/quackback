import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  DocumentTextIcon,
  HandThumbUpIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/20/solid'
import { Button } from '@/components/ui/button'
import { analyticsQueries } from '@/lib/client/queries/analytics'
import { cn } from '@/lib/shared/utils'
import { StatCard } from './stat-card'
import { TrendingSection } from './trending-section'
import { AttentionSection } from './attention-section'
import { SentimentCard } from './sentiment-card'
import { PipelineCard } from './pipeline-card'
import { ResponseHealthCard } from './response-health-card'

type Period = '7d' | '30d' | '90d'

const PERIODS: Period[] = ['7d', '30d', '90d']

const PERIOD_LABELS: Record<Period, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
}

export function BriefingPage({ period }: { period: Period }) {
  const navigate = useNavigate()
  const { data } = useSuspenseQuery(analyticsQueries.briefing(period))

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Your Briefing</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Last {PERIOD_LABELS[period]} vs previous period
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

        {/* KPI Hero Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="New Posts"
            icon={DocumentTextIcon}
            current={data.activity.current.posts}
            previous={data.activity.previous.posts}
            sparkData={data.activity.timeSeries.posts}
            index={0}
          />
          <StatCard
            label="Votes"
            icon={HandThumbUpIcon}
            current={data.activity.current.votes}
            previous={data.activity.previous.votes}
            sparkData={data.activity.timeSeries.votes}
            index={1}
          />
          <StatCard
            label="Comments"
            icon={ChatBubbleLeftRightIcon}
            current={data.activity.current.comments}
            previous={data.activity.previous.comments}
            sparkData={data.activity.timeSeries.comments}
            index={2}
          />
        </div>

        {/* Trending + Attention (side by side on desktop) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <TrendingSection posts={data.trending} />
          <AttentionSection data={data.attention} />
        </div>

        {/* Bottom Row: Sentiment + Pipeline + Response Health */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <SentimentCard data={data.sentiment} />
          <PipelineCard statuses={data.pipeline} />
          <ResponseHealthCard data={data.responseHealth} />
        </div>
      </div>
    </div>
  )
}
