import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { SlackConnectionActions } from '@/components/admin/settings/integrations/slack/slack-connection-actions'
import { SlackConfig } from '@/components/admin/settings/integrations/slack/slack-config'
import { Button } from '@/components/ui/button'
import { SlackIcon } from '@/components/icons/integration-icons'
import { slackCatalog } from '@/lib/server/integrations/slack/catalog'

export const Route = createFileRoute('/admin/settings/integrations/slack')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('slack'))
    return {}
  },
  component: SlackIntegrationPage,
})

function SlackIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('slack'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={slackCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<SlackIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <SlackConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <SlackConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            notificationChannels={integration.notificationChannels}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<SlackIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your Slack workspace"
          description="Connect Slack to receive notifications when users submit feedback, when statuses change, and when comments are added."
          steps={[
            <p key="1">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to post messages to your Slack workspace.
            </p>,
            <p key="2">
              Select which channel notifications should be posted to. The bot must be added to
              private channels before they appear in the list.
            </p>,
            <p key="3">
              Choose which events trigger notifications. You can enable or disable individual event
              types at any time.
            </p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                    Configure credentials
                  </Button>
                  <SlackConnectionActions integrationId={undefined} isConnected={false} />
                </div>
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="slack"
          integrationName="Slack"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
