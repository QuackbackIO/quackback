import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { settingsQueries } from '@/lib/client/queries/settings'
import { ChannelsHubPage } from '@/components/admin/settings/channels-hub-page'
import { readBatch } from '@/lib/client/queries/read-batch'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/channels')({
  head: adminPageHead('Channels settings'),
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const { queryClient } = context
    const [{ channelSettingsQueries: channels }, { githubChannelStatusQuery: githubStatus }] =
      await Promise.all([
        import('@/lib/client/queries/channel-settings'),
        import('@/integrations/github/ui/github-channel-status-query'),
      ])
    // The status rows and the routing switch are warmed with the configs so
    // the hub renders complete from the document. A miss leaves a row to its
    // own fetch and its defaults, as before.
    const ensure = readBatch(queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      ensure(settingsQueries.portalConfig()),
      warmQuery(ensure, channels.emailStatus()),
      warmQuery(ensure, githubStatus()),
      warmQuery(ensure, channels.routing()),
    ])
    return {}
  },
  component: ChannelsHubPage,
})
