import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
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
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <TeamsConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
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
        <IntegrationSetupCard
          icon={<TeamsIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Microsoft Teams"
          description="Connect Microsoft Teams to receive notifications when users submit feedback, when statuses change, and when comments are added."
          steps={[
            <p key="1">
              Register Quackback in your Azure AD tenant and add the Teams bot permissions.
            </p>,
            <p key="2">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to post to your Teams channels.
            </p>,
            <p key="3">
              Select a team and channel for notifications, then choose which events trigger
              messages.
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
                  <TeamsConnectionActions integrationId={undefined} isConnected={false} />
                </div>
              )}
            </div>
          }
        />
      )}

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
