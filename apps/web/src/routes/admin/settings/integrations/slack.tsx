import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
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
          <div className="flex items-center gap-2">
            {platformCredentialFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                Configure credentials
              </Button>
            )}
            {platformCredentialsConfigured && (
              <SlackConnectionActions
                integrationId={integration?.id}
                isConnected={isConnected || isPaused}
              />
            )}
          </div>
        }
      />

      {/* Configuration Section */}
      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <SlackConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {/* Not Connected State */}
      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <SlackIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Slack workspace</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Slack to receive notifications when users submit feedback, when statuses change,
            and when comments are added.
          </p>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium text-foreground">Setup Instructions</h2>
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              1
            </span>
            <p>
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to post messages to your Slack workspace.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              Select which channel notifications should be posted to. The bot must be added to
              private channels before they appear in the list.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Choose which events trigger notifications. You can enable or disable individual event
              types at any time.
            </p>
          </div>
        </div>
      </div>

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
