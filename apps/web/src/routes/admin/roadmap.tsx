import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'
import { RoadmapModal } from '@/components/admin/roadmap-modal'

const searchSchema = z.object({
  roadmap: z.string().optional(),
  post: z.string().optional(), // Post ID for modal view
})

export const Route = createFileRoute('/admin/roadmap')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { queryClient } = context

    // Get user and member from parent's beforeLoad context
    const { user, member } = context as {
      user: NonNullable<typeof context.user>
      member: NonNullable<typeof context.member>
      queryClient: typeof context.queryClient
    }

    // Pre-fetch roadmap statuses using React Query
    await queryClient.ensureQueryData(adminQueries.roadmapStatuses())

    return {
      currentUser: {
        name: user.name,
        email: user.email,
        memberId: member.id,
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
