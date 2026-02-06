import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PuzzlePieceIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationList } from '@/components/admin/settings/integrations/integration-list'

export const Route = createFileRoute('/admin/settings/integrations/')({
  loader: async ({ context }) => {
    const { queryClient } = context

    await Promise.all([
      queryClient.ensureQueryData(adminQueries.integrationCatalog()),
      queryClient.ensureQueryData(adminQueries.integrations()),
    ])
  },
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const catalogQuery = useSuspenseQuery(adminQueries.integrationCatalog())
  const integrationsQuery = useSuspenseQuery(adminQueries.integrations())

  // Map to simplified status format for the catalog
  const integrations = integrationsQuery.data.map((i) => ({
    id: i.integrationType,
    status: i.status as 'active' | 'paused' | 'error',
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

      <IntegrationList catalog={catalogQuery.data} integrations={integrations} />
    </div>
  )
}
