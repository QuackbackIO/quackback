import { requireTenantRoleBySlug } from '@/lib/tenant'
import { Plug2 } from 'lucide-react'
import { db, organizationIntegrations, eq } from '@quackback/db'
import { IntegrationList } from './integration-list'

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { organization } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

  // Fetch existing integrations (minimal data for catalog view)
  const rawIntegrations = await db.query.organizationIntegrations.findMany({
    where: eq(organizationIntegrations.organizationId, organization.id),
  })

  // Map to simplified status format for the catalog
  const integrations = rawIntegrations.map((i) => ({
    id: i.integrationType,
    status: i.status as 'active' | 'paused' | 'error',
    workspaceName: i.externalWorkspaceName || undefined,
  }))

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Plug2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Connect external services to automate workflows
          </p>
        </div>
      </div>

      {/* Integration Catalog */}
      <IntegrationList integrations={integrations} />
    </div>
  )
}
