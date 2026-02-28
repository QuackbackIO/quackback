import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { TrelloConnectionActions } from '@/components/admin/settings/integrations/trello/trello-connection-actions'
import { TrelloConfig } from '@/components/admin/settings/integrations/trello/trello-config'
import { Button } from '@/components/ui/button'
import { TrelloIcon } from '@/components/icons/integration-icons'
import { trelloCatalog } from '@/lib/server/integrations/trello/catalog'

export const Route = createFileRoute('/admin/settings/integrations/trello')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('trello'))
    return {}
  },
  component: TrelloIntegrationPage,
})

function TrelloIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('trello'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={trelloCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<TrelloIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <TrelloConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <TrelloConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<TrelloIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your Trello workspace"
          description="Connect Trello to create cards from feedback and sync statuses between Trello lists and Quackback."
          steps={[
            <p key="1">
              Create a Trello Power-Up in your workspace (optional, only needed for custom
              branding).
            </p>,
            <p key="2">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to access your Trello workspace.
            </p>,
            <p key="3">Select which board and list new feedback cards should be created in.</p>,
            <p key="4">
              Choose which events trigger card creation. You can enable or disable individual event
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
                  <TrelloConnectionActions integrationId={undefined} isConnected={false} />
                </div>
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="trello"
          integrationName="Trello"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
