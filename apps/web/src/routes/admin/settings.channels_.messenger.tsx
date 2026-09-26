import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { MessengerChannelPage } from '@/components/admin/settings/messenger-channel-page'
import { readBatch } from '@/lib/client/queries/read-batch'

export const Route = createFileRoute('/admin/settings/channels_/messenger')({
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const ensure = readBatch(context.queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      ensure(settingsQueries.portalConfig()),
    ])
    return {}
  },
  component: MessengerChannelPage,
})
