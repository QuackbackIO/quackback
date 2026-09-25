import { createFileRoute } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { WidgetInstallPage } from '@/components/admin/settings/widget/widget-install-page'
import { settingsReadBatch } from '@/lib/client/queries/settings-batch'

export const Route = createFileRoute('/admin/settings/widget/install')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const ensure = settingsReadBatch(context.queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetSecret()),
      ensure(settingsQueries.widgetConfig()),
      ensure(adminQueries.onboardingStatus()),
    ])
  },
  component: WidgetInstallPage,
})
