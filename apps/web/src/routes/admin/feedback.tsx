import { createFileRoute, Outlet, useRouteContext } from '@tanstack/react-router'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { TabStrip, type TabStripItem } from '@/components/admin/tab-strip'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

const searchSchema = z.object({
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  owner: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.string().optional(),
  minComments: z.string().optional(),
  responded: z.enum(['all', 'responded', 'unresponded']).optional(),
  updatedBefore: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
  hasDuplicates: z.boolean().optional(),
  deleted: z.boolean().optional(),
  post: z.string().optional(),
  // Roadmap-specific
  roadmap: z.string().optional(),
  // Suggestion filters (for incoming sub-route)
  source: z.string().optional(),
  suggestionSort: z.enum(['newest', 'relevance']).optional(),
  suggestionSearch: z.string().optional(),
  suggestionStatus: z.enum(['pending', 'dismissed']).optional(),
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: searchSchema,
  component: FeedbackLayout,
})

function FeedbackLayout() {
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const { data: incomingStats } = useQuery(feedbackQueries.incomingCount())
  const incomingCount = incomingStats?.count ?? 0

  const tabs: TabStripItem[] = [
    { label: 'Posts', to: '/admin/feedback', exact: true },
    ...(flags?.aiFeedbackExtraction
      ? [{ label: 'Incoming', to: '/admin/feedback/incoming', badge: incomingCount }]
      : []),
  ]

  return (
    <div className="flex h-full flex-col">
      {tabs.length > 1 && <TabStrip tabs={tabs} />}
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
