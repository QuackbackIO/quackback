import { createFileRoute } from '@tanstack/react-router'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import { portalQueries } from '@/lib/queries/portal'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { RoadmapId, StatusId } from '@quackback/ids'

/**
 * Full roadmap page with kanban board
 */
export const Route = createFileRoute('/_portal/roadmap/')({
  loader: async ({ context }) => {
    const { queryClient } = context

    // Pre-fetch roadmaps and statuses in parallel
    const [roadmaps, statuses] = await Promise.all([
      queryClient.ensureQueryData(portalQueries.roadmaps()),
      queryClient.ensureQueryData(portalQueries.statuses()),
    ])

    // Filter statuses to only those shown on roadmap
    const roadmapStatuses = statuses.filter((s) => s.showOnRoadmap)

    // Pre-fetch posts for the first roadmap (will be auto-selected)
    if (roadmaps.length > 0 && roadmapStatuses.length > 0) {
      const firstRoadmapId = roadmaps[0].id as RoadmapId

      // Pre-fetch all status columns for the first roadmap in parallel
      // Using ensureInfiniteQueryData to match the infinite query structure used by components
      await Promise.all(
        roadmapStatuses.map(async (status) => {
          const statusId = status.id as StatusId
          const queryKey = ['portal', 'roadmapPosts', firstRoadmapId, statusId]

          // Fetch the first page
          const firstPage = await queryClient.fetchQuery(
            portalQueries.roadmapPosts({
              roadmapId: firstRoadmapId,
              statusId,
              limit: 20,
              offset: 0,
            })
          )

          // Set the data in infinite query format
          queryClient.setQueryData(queryKey, {
            pages: [firstPage],
            pageParams: [0],
          })
        })
      )
    }

    return {
      firstRoadmapId: roadmaps.length > 0 ? (roadmaps[0]?.id ?? null) : null,
      roadmapStatusIds: roadmapStatuses.map((s) => s.id),
    }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const loaderData = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const roadmapsQuery = useSuspenseQuery(portalQueries.roadmaps())
  const statusesQuery = useSuspenseQuery(portalQueries.statuses())

  const roadmaps = roadmapsQuery.data
  const statuses = statusesQuery.data.filter((s) => s.showOnRoadmap)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Roadmap</h1>
        <p className="text-muted-foreground">See what we're working on and what's coming next.</p>
      </div>

      <RoadmapBoard
        statuses={statuses as any}
        initialRoadmaps={roadmaps as any}
        initialSelectedRoadmapId={loaderData.firstRoadmapId}
      />
    </div>
  )
}
