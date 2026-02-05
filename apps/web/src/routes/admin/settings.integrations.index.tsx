import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PuzzlePieceIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
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
      <PageHeader
        icon={PuzzlePieceIcon}
        title="Integrations"
        description="Connect external services to automate workflows"
      />

      {/* Integration Catalog */}
      <IntegrationList integrations={integrations} />
    </div>
  )
}
