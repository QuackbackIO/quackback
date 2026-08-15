import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { ImportsHubPage } from '@/components/admin/settings/imports/imports-hub-page'

/**
 * Data > Imports & exports (§I1). Admin-only, no feature flag — importing
 * and exporting your own data is core self-hosted functionality, not an
 * experimental surface.
 */
export const Route = createFileRoute('/admin/settings/imports')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    await ensureBillingCatalogue(context.queryClient, context.billingEnabled)
  },
  component: ImportsHubPage,
})
