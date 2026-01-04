import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import { portalQueries } from '@/lib/queries/portal'

export const Route = createFileRoute('/_portal/roadmap/')({
  loader: async ({ context }) => {
    const { queryClient } = context

    const [roadmaps, statuses] = await Promise.all([
      queryClient.ensureQueryData(portalQueries.roadmaps()),
      queryClient.ensureQueryData(portalQueries.statuses()),
    ])

    const roadmapStatuses = statuses.filter((s) => s.showOnRoadmap)

    return {
      firstRoadmapId: roadmaps[0]?.id ?? null,
      roadmapStatusIds: roadmapStatuses.map((s) => s.id),
    }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const { firstRoadmapId } = Route.useLoaderData()

  const { data: roadmaps } = useSuspenseQuery(portalQueries.roadmaps())
  const { data: statuses } = useSuspenseQuery(portalQueries.statuses())

  const roadmapStatuses = statuses.filter((s) => s.showOnRoadmap)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Roadmap</h1>
        <p className="text-muted-foreground">See what we're working on and what's coming next.</p>
      </div>

      <RoadmapBoard
        statuses={roadmapStatuses}
        initialRoadmaps={roadmaps}
        initialSelectedRoadmapId={firstRoadmapId}
      />
    </div>
  )
}
