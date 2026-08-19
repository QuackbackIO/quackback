import { createFileRoute, Navigate } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { DocumentDuplicateIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { MacrosManager } from '@/components/admin/conversation/macros-manager'

export const Route = createFileRoute('/admin/settings/macros')({
  loader: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CONVERSATION_MANAGE)
  },
  component: MacrosSettingsRoute,
})

/** Gate behind the `supportInbox` flag, mirroring the messenger settings page. */
function MacrosSettingsRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings" />
  }
  return <MacrosSettingsPage />
}

function MacrosSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={DocumentDuplicateIcon}
        title="Macros"
        description="Reusable replies with variables and bundled actions"
      />
      <MacrosManager />
    </div>
  )
}
