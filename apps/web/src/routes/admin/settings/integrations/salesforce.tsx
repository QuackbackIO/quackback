import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { SalesforceConnectionActions } from '@/components/admin/settings/integrations/salesforce/salesforce-connection-actions'
import { SalesforceConfig } from '@/components/admin/settings/integrations/salesforce/salesforce-config'
import { SalesforceIcon } from '@/components/icons/integration-icons'
import { salesforceCatalog } from '@/lib/server/integrations/salesforce/catalog'

export const Route = createFileRoute('/admin/settings/integrations/salesforce')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('salesforce'))
    return {}
  },
  component: SalesforceIntegrationPage,
})

function SalesforceIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('salesforce'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={salesforceCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<SalesforceIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <SalesforceConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <SalesforceConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<SalesforceIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Salesforce"
          description="Connect Salesforce to enrich feedback with CRM data. See account details, opportunity stage, and deal value alongside each feedback submission."
          steps={[
            <p key="1">
              Configure your Salesforce{' '}
              <span className="font-medium text-foreground">Connected App credentials</span> in the
              platform settings.
            </p>,
            <p key="2">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback with your Salesforce org.
            </p>,
            <p key="3">
              Contact data will be automatically looked up by email when new feedback is submitted.
            </p>,
          ]}
          connectionForm={
            <SalesforceConnectionActions integrationId={undefined} isConnected={false} />
          }
        />
      )}
    </div>
  )
}
