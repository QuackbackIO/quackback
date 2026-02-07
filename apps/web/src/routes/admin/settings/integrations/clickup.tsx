import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { ClickUpConnectionActions } from '@/components/admin/settings/integrations/clickup/clickup-connection-actions'
import { ClickUpConfig } from '@/components/admin/settings/integrations/clickup/clickup-config'
import { Button } from '@/components/ui/button'
import { ClickUpIcon } from '@/components/icons/integration-icons'
import { clickupCatalog } from '@/lib/server/integrations/clickup/catalog'

export const Route = createFileRoute('/admin/settings/integrations/clickup')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('clickup'))
    return {}
  },
  component: ClickUpIntegrationPage,
})

function ClickUpIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('clickup'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={clickupCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<ClickUpIcon className="h-6 w-6" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <ClickUpConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <ClickUpConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<ClickUpIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your ClickUp workspace"
          description="Connect ClickUp to turn feedback into tasks and track progress directly from your workspace."
          steps={[
            <p key="1">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to create tasks in your ClickUp workspace.
            </p>,
            <p key="2">Select a space and list where new feedback tasks should be created.</p>,
            <p key="3">
              Choose which events trigger task creation. You can change these settings at any time.
            </p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <ClickUpConnectionActions integrationId={undefined} isConnected={false} />
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="clickup"
          integrationName="ClickUp"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
