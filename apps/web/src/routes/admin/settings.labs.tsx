import { createFileRoute } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { BeakerIcon } from '@heroicons/react/24/solid'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { EmptyState } from '@/components/shared/empty-state'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'

export const Route = createFileRoute('/admin/settings/labs')({
  loader: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
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
