import { createFileRoute, Navigate } from '@tanstack/react-router'
import { CircleStackIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { ConnectorsManager } from '@/components/admin/automation/connectors/connectors-manager'

export const Route = createFileRoute('/admin/automation/connectors')({
  component: ConnectorsPageRoute,
})

/** Gate behind the `dataConnectors` flag, mirroring the workflows page. */
function ConnectorsPageRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.dataConnectors) {
    return <Navigate to="/admin/automation/assistant" />
  }
  return <ConnectorsPage />
}

function ConnectorsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">AI &amp; Automation</BackLink>
      </div>
      <PageHeader
        icon={CircleStackIcon}
        title="Data connectors"
        description="Let the AI assistant call external APIs to look up or update data"
      />
      <ConnectorsManager />
    </div>
  )
}
