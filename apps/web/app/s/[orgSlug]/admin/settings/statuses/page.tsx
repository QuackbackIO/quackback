import { requireTenantBySlug } from '@/lib/tenant'
import { Settings } from 'lucide-react'
import { StatusList } from './status-list'
import { getStatusService } from '@/lib/services'

export default async function StatusesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { organization } = await requireTenantBySlug(orgSlug)

  // Services now return TypeIDs directly
  const statusesResult = await getStatusService().listPublicStatuses(organization.id)
  const statuses = statusesResult.success ? statusesResult.value : []

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Public Statuses</h1>
          <p className="text-sm text-muted-foreground">
            Customize the statuses available for feedback posts
          </p>
        </div>
      </div>

      <StatusList initialStatuses={statuses} organizationId={organization.id} />
    </div>
  )
}
