import { createFileRoute, Outlet } from '@tanstack/react-router'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { TabStrip, type TabStripItem } from '@/components/admin/tab-strip'

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
  deleted: z.boolean().optional(),
  post: z.string().optional(),
  // Roadmap-specific
  roadmap: z.string().optional(),
  // Suggestion filters (for incoming sub-route)
  suggestionSource: z.array(z.string()).optional(),
  suggestionSort: z.enum(['newest', 'relevance']).optional(),
  suggestionSearch: z.string().optional(),
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: searchSchema,
  component: FeedbackLayout,
})

function FeedbackLayout() {
  const { data: incomingStats } = useQuery(feedbackQueries.incomingCount())
  const incomingCount = incomingStats?.count ?? 0

  const tabs: TabStripItem[] = [
    { label: 'Posts', to: '/admin/feedback', exact: true },
    { label: 'Incoming', to: '/admin/feedback/incoming', badge: incomingCount },
  ]

  return (
    <div className="flex h-full flex-col">
      <TabStrip tabs={tabs} />
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
