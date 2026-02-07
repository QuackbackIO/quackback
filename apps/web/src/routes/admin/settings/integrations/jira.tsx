import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { JiraConnectionActions } from '@/components/admin/settings/integrations/jira/jira-connection-actions'
import { JiraConfig } from '@/components/admin/settings/integrations/jira/jira-config'
import { Button } from '@/components/ui/button'
import { JiraIcon } from '@/components/icons/integration-icons'
import { jiraCatalog } from '@/lib/server/integrations/jira/catalog'

export const Route = createFileRoute('/admin/settings/integrations/jira')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('jira'))
    return {}
  },
  component: JiraIntegrationPage,
})

function JiraIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('jira'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={jiraCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<JiraIcon className="h-6 w-6" />}
        actions={
          <div className="flex items-center gap-2">
            {platformCredentialFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                Configure credentials
              </Button>
            )}
            {platformCredentialsConfigured && (
              <JiraConnectionActions
                integrationId={integration?.id}
                isConnected={isConnected || isPaused}
              />
            )}
          </div>
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <JiraConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <JiraIcon className="mx-auto h-10 w-10" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Jira instance</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Jira to automatically create and sync issues from feedback posts, keeping your
            team's workflow in sync.
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
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to create issues in your Jira instance.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>Select which project and issue type to use for new feedback issues.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Choose which events trigger issue creation. You can change these settings at any time.
            </p>
          </div>
        </div>
      </div>

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="jira"
          integrationName="Jira"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
