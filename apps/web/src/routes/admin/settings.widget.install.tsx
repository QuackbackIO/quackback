import { createFileRoute } from '@tanstack/react-router'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { WidgetInstallPage } from '@/components/admin/settings/widget/widget-install-page'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/widget/install')({
  head: adminPageHead('Install the widget'),
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/widget/install')
    const ensure = readBatch(context.queryClient)
    await Promise.all([
      ensure(settingsQueries.widgetSecret()),
      ensure(settingsQueries.widgetConfig()),
      // The install status needs member.view, which settings.manage does not.
      context.permissions?.includes(PERMISSIONS.MEMBER_VIEW)
        ? ensure(adminQueries.onboardingStatus())
        : undefined,
    ])
    return seedAdminAreas(context.personLocale, 'adminChannelSettings')
  },
  component: WidgetInstallPage,
})
