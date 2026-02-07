import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { GitHubConnectionActions } from '@/components/admin/settings/integrations/github/github-connection-actions'
import { GitHubConfig } from '@/components/admin/settings/integrations/github/github-config'
import { Button } from '@/components/ui/button'
import { GitHubIcon } from '@/components/icons/integration-icons'
import { githubCatalog } from '@/lib/server/integrations/github/catalog'

export const Route = createFileRoute('/admin/settings/integrations/github')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('github'))
    return {}
  },
  component: GitHubIntegrationPage,
})

function GitHubIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('github'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={githubCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<GitHubIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <GitHubConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <GitHubConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<GitHubIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your GitHub account"
          description="Connect GitHub to automatically create issues from user feedback and sync statuses when issues are closed or reopened."
          steps={[
            <p key="1">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to create issues in your GitHub repositories.
            </p>,
            <p key="2">Select which repository new feedback issues should be created in.</p>,
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
                <GitHubConnectionActions integrationId={undefined} isConnected={false} />
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="github"
          integrationName="GitHub"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
