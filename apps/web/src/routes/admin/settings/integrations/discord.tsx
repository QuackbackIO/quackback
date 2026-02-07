import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
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
          <div className="flex items-center gap-2">
            {platformCredentialFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                Configure credentials
              </Button>
            )}
            {platformCredentialsConfigured && (
              <DiscordConnectionActions
                integrationId={integration?.id}
                isConnected={isConnected || isPaused}
              />
            )}
          </div>
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
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <DiscordIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Discord server</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Discord to receive notifications when users submit feedback, when statuses
            change, and when comments are added.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium text-foreground">Setup Instructions</h2>
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              1
            </span>
            <p>
              Click <span className="font-medium text-foreground">Connect</span> to add the
              Quackback bot to your Discord server.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              Select which text channel notifications should be posted to. The bot needs access to
              the channel.
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
