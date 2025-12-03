import { getStatusesByOrganization } from '@quackback/db'
import { requireTenant } from '@/lib/tenant'
import { StatusList } from './status-list'

export default async function StatusesPage() {
  const { organization } = await requireTenant()

  const statuses = await getStatusesByOrganization(organization.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Public Statuses</h1>
        <p className="text-muted-foreground">
          Customize the statuses available for feedback posts. Choose which statuses appear on your
          public roadmap.
        </p>
      </div>

      <StatusList initialStatuses={statuses} organizationId={organization.id} />
    </div>
  )
}
