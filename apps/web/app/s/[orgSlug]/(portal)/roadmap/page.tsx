import { getOrganizationBySlug } from '@/lib/tenant'
import { getPostService, getStatusService } from '@/lib/services'
import { RoadmapBoard } from '@/components/public/roadmap-board'

interface RoadmapPageProps {
  params: Promise<{ orgSlug: string }>
}

/**
 * Full roadmap page with kanban board
 */
export default async function RoadmapPage({ params }: RoadmapPageProps) {
  const { orgSlug } = await params
  const org = await getOrganizationBySlug(orgSlug)

  if (!org) {
    return null
  }

  // Get statuses marked for roadmap display
  const statusesResult = await getStatusService().listPublicStatuses(org.id)
  const allStatuses = statusesResult.success ? statusesResult.value : []
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

  // Fetch first page (10 posts) for each status in parallel
  const postService = getPostService()
  const initialDataPromises = roadmapStatuses.map(async (status) => {
    const result = await postService.getRoadmapPostsPaginated({
      organizationId: org.id,
      statusSlug: status.slug,
      page: 1,
      limit: 10,
    })
    return {
      statusSlug: status.slug,
      data: result.success ? result.value : { items: [], total: 0, hasMore: false },
    }
  })

  const initialDataByStatus = await Promise.all(initialDataPromises)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Roadmap</h1>
        <p className="text-muted-foreground">See what we're working on and what's coming next.</p>
      </div>

      <RoadmapBoard
        organizationId={org.id}
        statuses={roadmapStatuses}
        initialDataByStatus={initialDataByStatus}
      />
    </div>
  )
}
