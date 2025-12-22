import { requireAuthenticatedTenant } from '@/lib/tenant'
import { getStatusService } from '@/lib/services'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'

export default async function RoadmapPage({ params }: { params?: Promise<{}> }) {
  // Settings is validated in root layout
  const { settings } = await requireAuthenticatedTenant()

  // Get statuses marked for roadmap display (services now return TypeIDs directly)
  const statusesResult = await getStatusService().listPublicStatuses()
  const allStatuses = statusesResult.success ? statusesResult.value : []
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

  return (
    <main className="h-full">
      <RoadmapAdmin workspaceId={settings.id} statuses={roadmapStatuses} />
    </main>
  )
}
