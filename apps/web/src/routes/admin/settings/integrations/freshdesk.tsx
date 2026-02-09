import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { FreshdeskConnectionActions } from '@/components/admin/settings/integrations/freshdesk/freshdesk-connection-actions'
import { FreshdeskConfig } from '@/components/admin/settings/integrations/freshdesk/freshdesk-config'
import { FreshdeskIcon } from '@/components/icons/integration-icons'
import { freshdeskCatalog } from '@/lib/server/integrations/freshdesk/catalog'

export const Route = createFileRoute('/admin/settings/integrations/freshdesk')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('freshdesk'))
    return {}
  },
  component: FreshdeskIntegrationPage,
})

function FreshdeskIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('freshdesk'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={freshdeskCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<FreshdeskIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <FreshdeskConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <FreshdeskConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<FreshdeskIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Freshdesk"
          description="Connect Freshdesk to enrich feedback with support ticket data. See open tickets, satisfaction scores, and contact details alongside each submission."
          steps={[
            <p key="1">
              Find your <span className="font-medium text-foreground">API key</span> in your
              Freshdesk profile settings.
            </p>,
            <p key="2">
              Enter your Freshdesk subdomain and API key below, then click{' '}
              <span className="font-medium text-foreground">Save</span>. Quackback will verify the
              connection.
            </p>,
            <p key="3">
              Contact data will be automatically looked up by email when new feedback is submitted.
            </p>,
          ]}
          connectionForm={
            <FreshdeskConnectionActions integrationId={undefined} isConnected={false} />
          }
        />
      )}
    </div>
  )
}
