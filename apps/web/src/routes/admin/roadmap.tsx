import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'
import { RoadmapModal } from '@/components/admin/roadmap-modal'

const searchSchema = z.object({
  roadmap: z.string().optional(),
  post: z.string().optional(), // Post ID for modal view
  search: z.string().optional(),
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  sort: z.enum(['votes', 'newest', 'oldest']).optional(),
})

export const Route = createFileRoute('/admin/roadmap')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { queryClient } = context

    // Get user and principal from parent's beforeLoad context
    const { user, principal } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    // Pre-fetch roadmap statuses and filter reference data
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.roadmapStatuses()),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.segments()),
    ])

    return {
      currentUser: {
        name: user.name,
        email: user.email,
        principalId: principal.id,
      },
    }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const { currentUser } = Route.useLoaderData()
  const search = Route.useSearch()

  // Read pre-fetched data from React Query cache
  const roadmapStatusesQuery = useSuspenseQuery(adminQueries.roadmapStatuses())

  return (
    <main className="h-full">
      <RoadmapAdmin statuses={roadmapStatusesQuery.data} />
      <RoadmapModal postId={search.post} currentUser={currentUser} />
    </main>
  )
}
