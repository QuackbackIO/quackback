import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { WidgetSettingsGate } from '@/components/admin/settings/widget/widget-settings-page'
import { readBatch } from '@/lib/client/queries/read-batch'

export const Route = createFileRoute('/admin/settings/widget')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)

    const { queryClient } = context
    const ensure = readBatch(queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      ensure(adminQueries.boards()),
      ensure(adminQueries.onboardingStatus()),
    ])

    return {}
  },
  component: WidgetSettingsGate,
})
