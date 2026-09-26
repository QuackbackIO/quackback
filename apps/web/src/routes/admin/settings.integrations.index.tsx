import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PuzzlePieceIcon } from '@heroicons/react/24/solid'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationsSettingsBody } from '@/components/admin/settings/integrations/integrations-settings-body'
import { settingsReadBatch } from '@/lib/client/queries/settings-batch'

export const Route = createFileRoute('/admin/settings/integrations/')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.INTEGRATION_VIEW)
    const { queryClient } = context
    const { hasTierFeatureFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = settingsReadBatch(queryClient)
    const [integrationsEnabled] = await Promise.all([
      hasTierFeatureFn({ data: { feature: 'integrations' } }),
      ensure(adminQueries.integrationCatalog()),
      ensure(adminQueries.integrations()),
      ensureBillingCatalogue(queryClient, context.billingEnabled),
    ])
    return { integrationsEnabled }
  },
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const { integrationsEnabled } = Route.useLoaderData()
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

      <IntegrationsSettingsBody
        enabled={integrationsEnabled}
        catalog={catalogQuery.data}
        integrations={integrations}
      />
    </div>
  )
}
