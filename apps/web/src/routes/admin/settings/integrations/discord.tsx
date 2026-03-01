import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { DiscordConnectionActions } from '@/components/admin/settings/integrations/discord/discord-connection-actions'
import { DiscordConfig } from '@/components/admin/settings/integrations/discord/discord-config'
import { Button } from '@/components/ui/button'
import { DiscordIcon } from '@/components/icons/integration-icons'
import { discordCatalog } from '@/lib/server/integrations/discord/catalog'

export const Route = createFileRoute('/admin/settings/integrations/discord')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('discord'))
    return {}
  },
  component: DiscordIntegrationPage,
})

function DiscordIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('discord'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={discordCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<DiscordIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <DiscordConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <DiscordConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<DiscordIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your Discord server"
          description="Connect Discord to receive notifications when users submit feedback, when statuses change, and when comments are added."
          steps={[
            <p key="1">
              Click <span className="font-medium text-foreground">Connect</span> to add the
              Quackback bot to your Discord server.
            </p>,
            <p key="2">
              Select which text channel notifications should be posted to. The bot needs access to
              the channel.
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
                  <DiscordConnectionActions integrationId={undefined} isConnected={false} />
                </div>
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="discord"
          integrationName="Discord"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
