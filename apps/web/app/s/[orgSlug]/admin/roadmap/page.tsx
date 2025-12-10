import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import { getStatusService } from '@/lib/services'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'

export default async function RoadmapPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { organization } = await requireAuthenticatedTenantBySlug(orgSlug)

  // Get statuses marked for roadmap display
  const statusesResult = await getStatusService().listPublicStatuses(organization.id)
  const allStatuses = statusesResult.success ? statusesResult.value : []
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

  return (
    <main className="h-full">
      <RoadmapAdmin organizationId={organization.id} statuses={roadmapStatuses} />
    </main>
  )
}
