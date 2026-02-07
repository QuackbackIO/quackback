import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { ZapierConnectionActions } from '@/components/admin/settings/integrations/zapier/zapier-connection-actions'
import { ZapierConfig } from '@/components/admin/settings/integrations/zapier/zapier-config'
import { ZapierIcon } from '@/components/icons/integration-icons'
import { zapierCatalog } from '@/lib/server/integrations/zapier/catalog'

export const Route = createFileRoute('/admin/settings/integrations/zapier')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('zapier'))
    return {}
  },
  component: ZapierIntegrationPage,
})

function ZapierIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('zapier'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={zapierCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<ZapierIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <ZapierConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <ZapierConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<ZapierIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Zapier"
          description="Connect Zapier to trigger automated workflows when users submit feedback, when statuses change, and when comments are added."
          steps={[
            <p key="1">
              Create a new Zap in Zapier and add a{' '}
              <span className="font-medium text-foreground">Webhooks by Zapier</span> trigger with{' '}
              <span className="font-medium text-foreground">Catch Hook</span>.
            </p>,
            <p key="2">
              Copy the webhook URL from Zapier and paste it below, then click{' '}
              <span className="font-medium text-foreground">Save</span>. Quackback will send a test
              payload.
            </p>,
            <p key="3">
              Choose which events should trigger your Zap, then continue building your workflow in
              Zapier.
            </p>,
          ]}
          connectionForm={<ZapierConnectionActions integrationId={undefined} isConnected={false} />}
        />
      )}
    </div>
  )
}
