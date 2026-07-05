import { createFileRoute, Navigate } from '@tanstack/react-router'
import { BoltIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { settingsQueries } from '@/lib/client/queries/settings'
import { AgentPriorityBanner } from '@/components/admin/automation/agent-priority-banner'
import { WorkflowsManager } from '@/components/admin/automation/workflows-manager'

export const Route = createFileRoute('/admin/automation/workflows')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(settingsQueries.widgetConfig())
    return {}
  },
  component: WorkflowsPageRoute,
})

/** Gate behind the `supportInbox` flag, mirroring the messenger settings page. */
function WorkflowsPageRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/automation/assistant" />
  }
  return <WorkflowsPage />
}

function WorkflowsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">AI &amp; Automation</BackLink>
      </div>
      <PageHeader
        icon={BoltIcon}
        title="Workflows"
        description="Trigger-driven automation for conversations and tickets"
      />
      <AgentPriorityBanner />
      <WorkflowsManager />
    </div>
  )
}
