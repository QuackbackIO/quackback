import { createFileRoute, Outlet } from '@tanstack/react-router'
import { z } from 'zod'
import { adminQueries } from '@/lib/queries/admin'

const searchSchema = z.object({
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  owner: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
  selected: z.string().optional(),
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient } = context

    // Pre-fetch boards for the feedback views
    await queryClient.ensureQueryData(adminQueries.boards())

    return {}
  },
  component: FeedbackLayout,
})

function FeedbackLayout() {
  return <Outlet />
}
