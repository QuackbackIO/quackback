import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { BeakerIcon } from '@heroicons/react/24/solid'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { EmptyState } from '@/components/shared/empty-state'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/labs')({
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/labs')
    return seedAdminAreas(context.personLocale, 'adminWorkspaceSettings')
  },
  component: LabsSettingsPage,
})

function LabsSettingsPage() {
  const intl = useIntl()
  return (
    <SettingsPage page="/admin/settings/labs">
      <EmptyState
        icon={BeakerIcon}
        size="compact"
        title={intl.formatMessage({
          id: 'settings.labs.empty.title',
          defaultMessage: 'No experiments right now',
        })}
        description={intl.formatMessage({
          id: 'settings.labs.empty.description',
          defaultMessage: 'Features you can try before they ship show up here.',
        })}
      />
    </SettingsPage>
  )
}
