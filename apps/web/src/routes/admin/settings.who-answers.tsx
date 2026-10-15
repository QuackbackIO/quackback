import { createFileRoute, redirect } from '@tanstack/react-router'
import { WhoAnswersPage } from '@/components/admin/settings/who-answers-page'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'
import { settingsQueries } from '@/lib/client/queries/settings'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/who-answers')({
  head: adminPageHead('Who answers settings'),
  beforeLoad: ({ context }) => {
    if (!context.settings?.featureFlags?.supportInbox) {
      throw redirect({ to: '/admin/settings/general' })
    }
    assertRouteAnyPermission(context.permissions, [
      PERMISSIONS.AI_CUSTOMER_MANAGE,
      PERMISSIONS.WORKFLOW_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ])
  },
  loader: async ({ context }) => {
    const { queryClient } = context
    const held = new Set<string>(context.permissions ?? [])
    await Promise.all([
      warmQuery(queryClient, settingsQueries.widgetConfig()),
      held.has(PERMISSIONS.SETTINGS_MANAGE)
        ? warmQuery(queryClient, channelSettingsQueries.routing())
        : undefined,
    ])
    return {}
  },
  component: WhoAnswersPage,
})
