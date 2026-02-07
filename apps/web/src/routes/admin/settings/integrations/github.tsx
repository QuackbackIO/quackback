import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { GitHubConnectionActions } from '@/components/admin/settings/integrations/github/github-connection-actions'
import { GitHubConfig } from '@/components/admin/settings/integrations/github/github-config'
import { githubCatalog } from '@/lib/server/integrations/github/catalog'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

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
  const integration = integrationQuery.data

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
          <GitHubConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
          />
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
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <GitHubIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your GitHub account</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect GitHub to automatically create issues from user feedback and sync statuses when
            issues are closed or reopened.
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
              Quackback to create issues in your GitHub repositories.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>Select which repository new feedback issues should be created in.</p>
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
    </div>
  )
}
