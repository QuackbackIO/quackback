import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PuzzlePieceIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationList } from '@/components/admin/settings/integrations/integration-list'

export const Route = createFileRoute('/admin/settings/integrations/')({
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { queryClient } = context

    // Pre-fetch integrations data
    await queryClient.ensureQueryData(adminQueries.integrations())

    return {}
  },
  component: IntegrationsPage,
})

function IntegrationsPage() {
  // Read pre-fetched data from React Query cache
  const integrationsQuery = useSuspenseQuery(adminQueries.integrations())
  const rawIntegrations = integrationsQuery.data

  // Map to simplified status format for the catalog
  const integrations = rawIntegrations.map((i) => ({
    id: i.integrationType,
    status: i.status as 'active' | 'paused' | 'error',
    workspaceName: i.externalWorkspaceName || undefined,
  }))

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <PuzzlePieceIcon className="h-5 w-5 text-primary" />
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
