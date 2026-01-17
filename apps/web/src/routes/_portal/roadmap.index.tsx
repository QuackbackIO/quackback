import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { RoadmapBoard } from '@/components/public/roadmap-board'
import { portalQueries } from '@/lib/queries/portal'

const searchSchema = z.object({
  roadmap: z.string().optional(),
})

export const Route = createFileRoute('/_portal/roadmap/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient } = context

    const [roadmaps] = await Promise.all([
      queryClient.ensureQueryData(portalQueries.roadmaps()),
      queryClient.ensureQueryData(portalQueries.statuses()),
    ])

    return { firstRoadmapId: roadmaps[0]?.id ?? null }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const { firstRoadmapId } = Route.useLoaderData()
  const { roadmap: selectedRoadmapFromUrl } = Route.useSearch()

  const { data: roadmaps } = useSuspenseQuery(portalQueries.roadmaps())
  const { data: statuses } = useSuspenseQuery(portalQueries.statuses())

  const roadmapStatuses = statuses.filter((s) => s.showOnRoadmap)

  // Use URL param if present, otherwise fall back to first roadmap
  const initialSelectedId = selectedRoadmapFromUrl ?? firstRoadmapId

  return (
    <div className="py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Roadmap</h1>
        <p className="text-muted-foreground">See what we're working on and what's coming next.</p>
      </div>

      <RoadmapBoard
        statuses={roadmapStatuses}
        initialRoadmaps={roadmaps}
        initialSelectedRoadmapId={initialSelectedId}
      />
    </div>
  )
}
