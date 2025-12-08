import { getCurrentOrganization } from '@/lib/tenant'
import { getPostService, getStatusService } from '@/lib/services'
import { RoadmapBoard } from '@/components/public/roadmap-board'

/**
 * Full roadmap page with kanban board
 */
export default async function RoadmapPage() {
  const org = await getCurrentOrganization()

  if (!org) {
    return null
  }

  // Get statuses marked for roadmap display
  const statusesResult = await getStatusService().listPublicStatuses(org.id)
  const allStatuses = statusesResult.success ? statusesResult.value : []
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

  // Get posts for the roadmap statuses
  const statusSlugs = roadmapStatuses.map((s) => s.slug)
  const roadmapPostsResult = await getPostService().getRoadmapPosts(org.id, statusSlugs)
  const roadmapPosts = roadmapPostsResult.success ? roadmapPostsResult.value : []

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Roadmap</h1>
        <p className="text-muted-foreground">See what we're working on and what's coming next.</p>
      </div>

      <RoadmapBoard posts={roadmapPosts} statuses={roadmapStatuses} />
    </div>
  )
}
