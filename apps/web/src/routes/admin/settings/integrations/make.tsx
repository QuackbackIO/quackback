import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { MakeConnectionActions } from '@/components/admin/settings/integrations/make/make-connection-actions'
import { MakeConfig } from '@/components/admin/settings/integrations/make/make-config'
import { MakeIcon } from '@/components/icons/integration-icons'
import { makeCatalog } from '@/lib/server/integrations/make/catalog'

export const Route = createFileRoute('/admin/settings/integrations/make')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('make'))
    return {}
  },
  component: MakeIntegrationPage,
})

function MakeIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('make'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={makeCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<MakeIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <MakeConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <MakeConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<MakeIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Make"
          description="Connect Make (formerly Integromat) to trigger automation scenarios when users submit feedback, when statuses change, and when comments are added."
          steps={[
            <p key="1">
              Create a new scenario in Make and add a{' '}
              <span className="font-medium text-foreground">Webhooks</span> module as the trigger.
            </p>,
            <p key="2">
              Copy the webhook URL and paste it below, then click{' '}
              <span className="font-medium text-foreground">Save</span>. Quackback will send a test
              payload.
            </p>,
            <p key="3">
              Choose which events should trigger your scenario, then continue building in Make.
            </p>,
          ]}
          connectionForm={<MakeConnectionActions integrationId={undefined} isConnected={false} />}
        />
      )}
    </div>
  )
}
