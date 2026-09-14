import { createFileRoute } from '@tanstack/react-router'
import { LabsSettings } from '@/components/admin/settings/labs/labs-settings'
import { listVisibleLabsExperimentsFn } from '@/lib/server/functions/labs'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'

export const Route = createFileRoute('/admin/settings/labs')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    const experiments = await listVisibleLabsExperimentsFn()
    return { experiments }
  },
  component: LabsSettingsPage,
})

function LabsSettingsPage() {
  const { experiments } = Route.useLoaderData()
  return <LabsSettings experiments={experiments} />
}
