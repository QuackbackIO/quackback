import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import { getPostService, getStatusService } from '@/lib/services'
import { AdminRoadmapBoard } from '@/components/admin/roadmap-board'

export default async function RoadmapPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { organization } = await requireAuthenticatedTenantBySlug(orgSlug)

  // Get statuses marked for roadmap display
  const statusesResult = await getStatusService().listPublicStatuses(organization.id)
  const allStatuses = statusesResult.success ? statusesResult.value : []
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

  // Fetch first page (10 posts) for each status in parallel
  const postService = getPostService()
  const initialDataPromises = roadmapStatuses.map(async (status) => {
    const result = await postService.getRoadmapPostsPaginated({
      organizationId: organization.id,
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
    <main className="px-6 py-8">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-foreground">Roadmap</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag and drop posts between columns to change their status
        </p>
      </div>

      <AdminRoadmapBoard
        organizationId={organization.id}
        statuses={roadmapStatuses}
        initialDataByStatus={initialDataByStatus}
      />
    </main>
  )
}
