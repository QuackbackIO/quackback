import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { NtfyConnectionActions } from '@/components/admin/settings/integrations/ntfy/ntfy-connection-actions'
import { NtfyConfig } from '@/components/admin/settings/integrations/ntfy/ntfy-config'
import { NtfyIcon } from '@/components/icons/integration-icons'
import { ntfyCatalog } from '@/lib/shared/integration-catalog'

export const Route = createFileRoute('/admin/settings/integrations/ntfy')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('ntfy'))
    return {}
  },
  component: NtfyIntegrationPage,
})

function NtfyIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('ntfy'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={ntfyCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<NtfyIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <NtfyConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <NtfyConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<NtfyIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect ntfy"
          description="Connect ntfy to receive instant push notifications when users submit feedback, statuses change, and comments are added."
          steps={[
            <p key="1">
              Create a topic on <span className="font-medium text-foreground">ntfy.sh</span> or your
              self-hosted ntfy server. Copy the full topic URL (e.g.{' '}
              <code className="text-xs">https://ntfy.sh/my-alerts</code>).
            </p>,
            <p key="2">
              Paste the topic URL below. If your topic is protected, add an access token too. Click{' '}
              <span className="font-medium text-foreground">Save</span> — Quackback will send a test
              notification to verify the channel.
            </p>,
            <p key="3">
              Choose which events should trigger notifications, then install the ntfy app on your
              devices and subscribe to your topic.
            </p>,
          ]}
          connectionForm={<NtfyConnectionActions integrationId={undefined} isConnected={false} />}
        />
      )}
    </div>
  )
}
