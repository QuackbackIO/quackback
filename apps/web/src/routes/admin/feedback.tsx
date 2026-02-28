import { createFileRoute, Outlet } from '@tanstack/react-router'
import { z } from 'zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { TabStrip, type TabStripItem } from '@/components/admin/tab-strip'
import { InboxIcon, SparklesIcon } from '@heroicons/react/24/solid'

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
  responded: z.enum(['all', 'responded', 'unresponded']).optional(),
  updatedBefore: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
  deleted: z.boolean().optional(),
  post: z.string().optional(),
  // Roadmap-specific
  roadmap: z.string().optional(),
  // Suggestion-specific
  suggestion: z.string().optional(),
  suggestionType: z.enum(['merge_post', 'create_post']).optional(),
  suggestionSource: z.array(z.string()).optional(),
  suggestionBoard: z.array(z.string()).optional(),
  suggestionSort: z.enum(['newest', 'similarity', 'confidence']).optional(),
  suggestionSearch: z.string().optional(),
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient } = context

    await Promise.all([
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(feedbackQueries.pipelineStats()),
      queryClient.ensureQueryData(feedbackQueries.suggestionStats()),
      queryClient.ensureQueryData(feedbackQueries.sources()),
    ])
  },
  component: FeedbackLayout,
})

function FeedbackLayout() {
  const statsQuery = useSuspenseQuery(feedbackQueries.suggestionStats())
  const pendingCount = statsQuery.data?.total ?? 0

  const viewTabs: TabStripItem[] = [
    { label: 'Inbox', to: '/admin/feedback', icon: InboxIcon, exact: true, search: {} },
    {
      label: 'Suggestions',
      to: '/admin/feedback/suggestions',
      icon: SparklesIcon,
      exact: false,
      search: {},
      badge: pendingCount,
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <TabStrip tabs={viewTabs} />

      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
