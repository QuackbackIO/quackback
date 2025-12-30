import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/queries/admin'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'

export const Route = createFileRoute('/admin/roadmap')({
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { queryClient } = context

    // Pre-fetch roadmap statuses using React Query
    await queryClient.ensureQueryData(adminQueries.roadmapStatuses())

    return {}
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  // Read pre-fetched data from React Query cache
  const roadmapStatusesQuery = useSuspenseQuery(adminQueries.roadmapStatuses())

  return (
    <main className="h-full">
      <RoadmapAdmin statuses={roadmapStatusesQuery.data} />
    </main>
  )
}
