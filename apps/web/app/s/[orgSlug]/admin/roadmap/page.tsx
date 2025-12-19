import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import { getStatusService } from '@/lib/services'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'

export default async function RoadmapPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { workspace } = await requireAuthenticatedTenantBySlug(orgSlug)

  // Get statuses marked for roadmap display (services now return TypeIDs directly)
  const statusesResult = await getStatusService().listPublicStatuses(workspace.id)
  const allStatuses = statusesResult.success ? statusesResult.value : []
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

  return (
    <main className="h-full">
      <RoadmapAdmin workspaceId={workspace.id} statuses={roadmapStatuses} />
    </main>
  )
}
