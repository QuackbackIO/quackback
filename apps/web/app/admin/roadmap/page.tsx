import { requireAuthenticatedTenant } from '@/lib/tenant'
import { listPublicStatuses } from '@/lib/statuses'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'

export default async function RoadmapPage() {
  // Settings is validated in root layout
  await requireAuthenticatedTenant()

  // Get statuses marked for roadmap display (services now return TypeIDs directly)
  const statusesResult = await listPublicStatuses()
  const allStatuses = statusesResult.success ? statusesResult.value : []
  const roadmapStatuses = allStatuses.filter((s) => s.showOnRoadmap)

  return (
    <main className="h-full">
      <RoadmapAdmin statuses={roadmapStatuses} />
    </main>
  )
}
