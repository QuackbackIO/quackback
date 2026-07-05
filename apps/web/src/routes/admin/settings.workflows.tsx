import { createFileRoute, Navigate } from '@tanstack/react-router'
import { BoltIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { WorkflowsManager } from '@/components/admin/automation/workflows-manager'

export const Route = createFileRoute('/admin/settings/workflows')({
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })
    return {}
  },
  component: WorkflowsSettingsRoute,
})

/** Gate behind the `supportInbox` flag, mirroring the messenger settings page. */
function WorkflowsSettingsRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/settings" />
  }
  return <WorkflowsSettingsPage />
}

function WorkflowsSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={BoltIcon}
        title="Workflows"
        description="Trigger-driven automation for conversations and tickets"
      />
      <WorkflowsManager />
    </div>
  )
}
