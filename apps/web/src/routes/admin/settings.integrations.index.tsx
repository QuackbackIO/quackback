import { lazy, Suspense } from 'react'
import { useCloudEnabled } from '@/lib/client/hooks/use-root-context'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import type { PlanNoticeFeature } from '@/components/admin/settings/plan-feature-notice-body'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationsSettingsBody } from '@/components/admin/settings/integrations/integrations-settings-body'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/integrations/')({
  head: adminPageHead('Integrations settings'),
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.INTEGRATION_VIEW)
    const { queryClient } = context
    const { hasTierFeatureFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(queryClient)
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
    <SettingsPage page="/admin/settings/integrations" width="wide">
      <PlanFeatureNotice feature="integrations" />
      <IntegrationsSettingsBody
        enabled={integrationsEnabled}
        catalog={catalogQuery.data}
        integrations={integrations}
      />
    </SettingsPage>
  )
}

/**
 * The paused notice. The plan billing check lives in this route rather than a
 * shared module, so without plan billing the page loads no extra chunk.
 */
const PlanFeatureNoticeBody = lazy(
  () => import('@/components/admin/settings/plan-feature-notice-body')
)

function PlanFeatureNotice({ feature }: { feature: PlanNoticeFeature }) {
  if (!useCloudEnabled()) return null
  return (
    <Suspense fallback={null}>
      <PlanFeatureNoticeBody feature={feature} />
    </Suspense>
  )
}
