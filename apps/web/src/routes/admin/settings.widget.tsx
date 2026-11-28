import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { WidgetSettingsGate } from '@/components/admin/settings/widget/widget-settings-page'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/widget')({
  head: adminPageHead('Widget settings'),
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/widget')

    const { queryClient } = context
    const ensure = readBatch(queryClient)
    // The default-board picker needs board.manage and the install status
    // member.view, neither of which settings.manage implies.
    const can = (permission: PermissionKey) => !!context.permissions?.includes(permission)
    await Promise.all([
      ensure(settingsQueries.widgetConfig()),
      can(PERMISSIONS.BOARD_MANAGE) ? ensure(adminQueries.boards()) : undefined,
      can(PERMISSIONS.MEMBER_VIEW) ? ensure(adminQueries.onboardingStatus()) : undefined,
    ])

    return { seededAreas: await seedAdminAreas(context.personLocale, 'adminChannelSettings') }
  },
  component: WidgetSettingsGate,
})
