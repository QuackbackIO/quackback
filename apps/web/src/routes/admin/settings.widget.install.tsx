import { createFileRoute } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { WidgetInstallPage } from '@/components/admin/settings/widget/widget-install-page'

export const Route = createFileRoute('/admin/settings/widget/install')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.widgetSecret()),
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      context.queryClient.ensureQueryData(adminQueries.onboardingStatus()),
    ])
  },
  component: WidgetInstallPage,
})
