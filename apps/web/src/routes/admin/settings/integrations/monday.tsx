import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { MondayConnectionActions } from '@/components/admin/settings/integrations/monday/monday-connection-actions'
import { MondayConfig } from '@/components/admin/settings/integrations/monday/monday-config'
import { MondayIcon } from '@/components/icons/integration-icons'
import { mondayCatalog } from '@/lib/server/integrations/monday/catalog'

export const Route = createFileRoute('/admin/settings/integrations/monday')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('monday'))
    return {}
  },
  component: MondayIntegrationPage,
})

function MondayIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('monday'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={mondayCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<MondayIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <MondayConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <MondayConfig
            integrationId={integration.id}
            initialConfig={(integration.config ?? {}) as { boardId?: string }}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<MondayIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Monday.com"
          description="Connect Monday.com to automatically create items from feedback and sync statuses between platforms."
          steps={[
            <p key="1">
              Configure your Monday.com{' '}
              <span className="font-medium text-foreground">OAuth credentials</span> in the platform
              settings.
            </p>,
            <p key="2">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback with your Monday.com workspace.
            </p>,
            <p key="3">
              Select a board to create items in, then choose which events should trigger new items.
            </p>,
          ]}
          connectionForm={<MondayConnectionActions integrationId={undefined} isConnected={false} />}
        />
      )}
    </div>
  )
}
