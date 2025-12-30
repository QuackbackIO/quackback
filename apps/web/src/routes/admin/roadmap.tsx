import { createFileRoute } from '@tanstack/react-router'
import { requireAuthenticatedWorkspace } from '@/lib/workspace'
import { listPublicStatuses } from '@/lib/statuses'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'

export const Route = createFileRoute('/admin/roadmap')({
  loader: async () => {
    // Settings is validated in root layout
    await requireAuthenticatedWorkspace()

    // Get statuses marked for roadmap display (services now return TypeIDs directly)
    const statusesResult = await listPublicStatuses()
    const allStatuses = statusesResult.success ? statusesResult.value : []
    const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

    return {
      roadmapStatuses,
    }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const { roadmapStatuses } = Route.useLoaderData()

  return (
    <main className="h-full">
      <RoadmapAdmin statuses={roadmapStatuses} />
    </main>
  )
}
