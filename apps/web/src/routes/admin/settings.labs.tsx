import { createFileRoute } from '@tanstack/react-router'
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
  return (
    <SettingsPage page="/admin/settings/labs">
      <EmptyState
        icon={BeakerIcon}
        size="compact"
        title="No experiments right now"
        description="Features you can try before they ship show up here."
      />
    </SettingsPage>
  )
}
