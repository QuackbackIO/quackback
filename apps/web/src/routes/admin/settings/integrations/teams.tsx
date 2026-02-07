import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { TeamsConnectionActions } from '@/components/admin/settings/integrations/teams/teams-connection-actions'
import { TeamsConfig } from '@/components/admin/settings/integrations/teams/teams-config'
import { Button } from '@/components/ui/button'
import { TeamsIcon } from '@/components/icons/integration-icons'
import { teamsCatalog } from '@/lib/server/integrations/teams/catalog'

export const Route = createFileRoute('/admin/settings/integrations/teams')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('teams'))
    return {}
  },
  component: TeamsIntegrationPage,
})

function TeamsIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('teams'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={teamsCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<TeamsIcon className="h-6 w-6 text-white" />}
        actions={
          <div className="flex items-center gap-2">
            {platformCredentialFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                Configure credentials
              </Button>
            )}
            {platformCredentialsConfigured && (
              <TeamsConnectionActions
                integrationId={integration?.id}
                isConnected={isConnected || isPaused}
              />
            )}
          </div>
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <TeamsConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <TeamsIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect Microsoft Teams</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Microsoft Teams to receive notifications when users submit feedback, when
            statuses change, and when comments are added.
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
            <p>Register Quackback in your Azure AD tenant and add the Teams bot permissions.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to post to your Teams channels.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Select a team and channel for notifications, then choose which events trigger
              messages.
            </p>
          </div>
        </div>
      </div>

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="teams"
          integrationName="Microsoft Teams"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
