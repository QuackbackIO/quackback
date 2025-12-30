import { createFileRoute } from '@tanstack/react-router'
import { requireWorkspaceRole } from '@/lib/workspace'
import { Plug2 } from 'lucide-react'
import { fetchIntegrationsList } from '@/lib/server-functions/admin'
import { IntegrationList } from '@/app/admin/settings/integrations/integration-list'

export const Route = createFileRoute('/admin/settings/integrations/')({
  loader: async () => {
    // Validate workspace role
    await requireWorkspaceRole(['owner', 'admin'])

    // Fetch existing integrations (minimal data for catalog view)
    const rawIntegrations = await fetchIntegrationsList()

    // Map to simplified status format for the catalog
    const integrations = rawIntegrations.map((i) => ({
      id: i.integrationType,
      status: i.status as 'active' | 'paused' | 'error',
      workspaceName: i.externalWorkspaceName || undefined,
    }))

    return { integrations }
  },
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const { integrations } = Route.useLoaderData()

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
