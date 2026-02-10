import { createFileRoute, Outlet } from '@tanstack/react-router'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { PostModal } from '@/components/admin/feedback/post-modal'

const searchSchema = z.object({
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  owner: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.string().optional(),
  responded: z.enum(['all', 'responded', 'unresponded']).optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
  post: z.string().optional(), // Post ID for modal view
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient } = context

    // Get user and principal from parent's beforeLoad context
    const { user, principal } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    // Pre-fetch boards for the feedback views
    await queryClient.ensureQueryData(adminQueries.boards())

    return {
      currentUser: {
        name: user.name,
        email: user.email,
        principalId: principal.id,
      },
    }
  },
  component: FeedbackLayout,
})

function FeedbackLayout() {
  const { currentUser } = Route.useLoaderData()
  const search = Route.useSearch()

  return (
    <>
      <Outlet />
      <PostModal postId={search.post} currentUser={currentUser} />
    </>
  )
}
