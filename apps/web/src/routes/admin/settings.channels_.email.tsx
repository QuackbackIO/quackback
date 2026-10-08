import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { settingsQueries } from '@/lib/client/queries/settings'
import { EmailChannelPage } from '@/components/admin/settings/email-channel-page'
import { readBatch } from '@/lib/client/queries/read-batch'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/channels_/email')({
  head: adminPageHead('Email channel settings'),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    const { permissions, queryClient } = context
    assertRoutePermission(permissions, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)
    const [{ channelSettingsQueries: channels }, { emailChannelConfigQuery }] = await Promise.all([
      import('@/lib/client/queries/channel-settings'),
      import('@/lib/client/queries/channel-accounts'),
    ])
    // Every card's read is warmed with the page so it renders complete from
    // the document. A miss leaves a card to its own fetch, as before; the
    // transport card's read needs settings.manage, which this page does not.
    const ensure = readBatch(queryClient)
    await Promise.all([
      ensure(settingsQueries.spamFilterConfig()),
      permissions?.includes(PERMISSIONS.SETTINGS_MANAGE)
        ? warmQuery(ensure, channels.emailStatus())
        : undefined,
      warmQuery(ensure, emailChannelConfigQuery()),
      warmQuery(ensure, channels.emailAutoAck()),
      warmQuery(ensure, channels.emailActivity()),
    ])
    return {}
  },
  component: EmailChannelPage,
})
