import { getSettings } from '@/lib/tenant'
import { listPublicRoadmaps } from '@/lib/roadmaps'
import { listPublicStatuses } from '@/lib/statuses'
import { RoadmapBoard } from '@/components/public/roadmap-board'

/**
 * Full roadmap page with kanban board
 */
export default async function RoadmapPage() {
  // Workspace is validated in root layout
  const settings = await getSettings()

  if (!settings) {
    return null
  }

  // Get statuses marked for roadmap display and public roadmaps in parallel
  // Services now return TypeIDs directly
  const [statusesResult, roadmapsResult] = await Promise.all([
    listPublicStatuses(),
    listPublicRoadmaps(),
  ])

  const allStatuses = statusesResult.success ? statusesResult.value : []
  const statuses = allStatuses.filter((s) => s.showOnRoadmap)
  const roadmaps = roadmapsResult.success ? roadmapsResult.value : []

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Roadmap</h1>
        <p className="text-muted-foreground">See what we're working on and what's coming next.</p>
      </div>

      <RoadmapBoard statuses={statuses} initialRoadmaps={roadmaps} />
    </div>
  )
}
