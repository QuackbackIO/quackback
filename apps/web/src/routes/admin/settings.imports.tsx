import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isAdmin } from '@/lib/shared/roles'
import { ImportsHubPage } from '@/components/admin/settings/imports/imports-hub-page'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'

/**
 * Data > Imports & exports (§I1). Admin-only, no feature flag — importing
 * and exporting your own data is core self-hosted functionality, not an
 * experimental surface.
 */
export const Route = createFileRoute('/admin/settings/imports')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    await Promise.all([
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
      // The CSV import's board picker, warmed so it is in the document.
      context.queryClient.ensureQueryData(adminQueries.boardsForSettings()).catch(() => undefined),
      // Both histories, so they are in the document too. Import history is
      // read by admins only.
      context.queryClient.ensureQueryData(settingsQueries.exportRuns()).catch(() => undefined),
      isAdmin(context.principal?.role)
        ? context.queryClient.ensureQueryData(settingsQueries.importRuns()).catch(() => undefined)
        : undefined,
    ])
  },
  component: ImportsHubPage,
})
