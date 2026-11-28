import { createFileRoute, redirect } from '@tanstack/react-router'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { settingsQueries } from '@/lib/client/queries/settings'
import { ChannelsHubPage } from '@/components/admin/settings/channels-hub-page'
import { readBatch } from '@/lib/client/queries/read-batch'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/channels')({
  head: adminPageHead('Channels settings'),
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/channels')
    const { queryClient } = context
    const [{ channelSettingsQueries: channels }, { githubChannelStatusQuery: githubStatus }] =
      await Promise.all([
        import('@/lib/client/queries/channel-settings'),
        import('@/integrations/github/ui/github-channel-status-query'),
      ])
    // The status rows are warmed with the configs so the hub renders
    // complete from the document. A miss leaves a row to its
    // own fetch and its defaults, as before.
    const ensure = readBatch(queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      ensure(settingsQueries.portalConfig()),
      warmQuery(ensure, channels.emailStatus()),
      warmQuery(ensure, githubStatus()),
    ])
    return seedAdminAreas(context.personLocale, 'adminChannelSettings')
  },
  component: ChannelsHubPage,
})
