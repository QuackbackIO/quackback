import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { MessengerChannelPage } from '@/components/admin/settings/messenger-channel-page'
import { settingsReadBatch } from '@/lib/client/queries/settings-batch'

export const Route = createFileRoute('/admin/settings/channels_/messenger')({
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const ensure = settingsReadBatch(context.queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      ensure(settingsQueries.portalConfig()),
    ])
    return {}
  },
  component: MessengerChannelPage,
})
