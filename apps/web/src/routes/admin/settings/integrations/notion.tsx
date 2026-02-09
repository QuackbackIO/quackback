import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { NotionConnectionActions } from '@/components/admin/settings/integrations/notion/notion-connection-actions'
import { NotionConfig } from '@/components/admin/settings/integrations/notion/notion-config'
import { Button } from '@/components/ui/button'
import { NotionIcon } from '@/components/icons/integration-icons'
import { notionCatalog } from '@/lib/server/integrations/notion/catalog'

export const Route = createFileRoute('/admin/settings/integrations/notion')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('notion'))
    return {}
  },
  component: NotionIntegrationPage,
})

function NotionIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('notion'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={notionCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<NotionIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <NotionConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <NotionConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<NotionIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your Notion workspace"
          description="Connect Notion to automatically create database items when users submit feedback. Link feedback to your product roadmap in Notion."
          steps={[
            <p key="1">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback with your Notion workspace.
            </p>,
            <p key="2">
              Select which database new feedback items should be created in. The database must have
              a Title property.
            </p>,
            <p key="3">
              Choose which events trigger new database items. You can change this at any time.
            </p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <NotionConnectionActions integrationId={undefined} isConnected={false} />
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="notion"
          integrationName="Notion"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
