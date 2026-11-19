import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { ModerationPage } from '@/components/admin/settings/moderation-settings-page'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/moderation')({
  head: adminPageHead('Moderation settings'),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/moderation')

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: ModerationPage,
})
