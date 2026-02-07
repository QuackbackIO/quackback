import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { LinearConnectionActions } from '@/components/admin/settings/integrations/linear/linear-connection-actions'
import { LinearConfig } from '@/components/admin/settings/integrations/linear/linear-config'
import { Button } from '@/components/ui/button'
import { LinearIcon } from '@/components/icons/integration-icons'
import { linearCatalog } from '@/lib/server/integrations/linear/catalog'

export const Route = createFileRoute('/admin/settings/integrations/linear')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('linear'))
    return {}
  },
  component: LinearIntegrationPage,
})

function LinearIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('linear'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={linearCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<LinearIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <LinearConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <LinearConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<LinearIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your Linear workspace"
          description="Connect Linear to automatically create issues from user feedback and keep statuses in sync across both platforms."
          steps={[
            <p key="1">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to create issues in your Linear workspace.
            </p>,
            <p key="2">Select which team new feedback issues should be created in.</p>,
            <p key="3">
              Choose which events trigger issue creation. You can change these settings at any time.
            </p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <LinearConnectionActions integrationId={undefined} isConnected={false} />
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="linear"
          integrationName="Linear"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
