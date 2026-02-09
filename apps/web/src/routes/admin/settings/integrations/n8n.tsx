import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { N8nConnectionActions } from '@/components/admin/settings/integrations/n8n/n8n-connection-actions'
import { N8nConfig } from '@/components/admin/settings/integrations/n8n/n8n-config'
import { N8nIcon } from '@/components/icons/integration-icons'
import { n8nCatalog } from '@/lib/server/integrations/n8n/catalog'

export const Route = createFileRoute('/admin/settings/integrations/n8n')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('n8n'))
    return {}
  },
  component: N8nIntegrationPage,
})

function N8nIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('n8n'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={n8nCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<N8nIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <N8nConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <N8nConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<N8nIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect n8n"
          description="Connect n8n to trigger automated workflows when users submit feedback, when statuses change, and when comments are added."
          steps={[
            <p key="1">
              Create a new workflow in n8n and add a{' '}
              <span className="font-medium text-foreground">Webhook</span> trigger node.
            </p>,
            <p key="2">
              Copy the production webhook URL and paste it below, then click{' '}
              <span className="font-medium text-foreground">Save</span>. Quackback will send a test
              payload.
            </p>,
            <p key="3">
              Choose which events should trigger your workflow, then continue building in n8n.
            </p>,
          ]}
          connectionForm={<N8nConnectionActions integrationId={undefined} isConnected={false} />}
        />
      )}
    </div>
  )
}
