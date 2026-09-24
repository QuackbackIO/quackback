import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { ModerationPage } from '@/components/admin/settings/moderation-settings-page'

export const Route = createFileRoute('/admin/settings/moderation')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MODERATION)

    const { queryClient } = context
    await queryClient.ensureQueryData(settingsQueries.portalConfig())
    return {}
  },
  component: ModerationPage,
})
