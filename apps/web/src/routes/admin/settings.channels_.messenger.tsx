import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { MessengerChannelPage } from '@/components/admin/settings/messenger-channel-page'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/channels_/messenger')({
  head: adminPageHead('Messenger channel settings'),
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/channels/messenger')
    const ensure = readBatch(context.queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      ensure(settingsQueries.portalConfig()),
    ])
    return seedAdminAreas(context.personLocale, 'adminChannelSettings')
  },
  component: MessengerChannelPage,
})
