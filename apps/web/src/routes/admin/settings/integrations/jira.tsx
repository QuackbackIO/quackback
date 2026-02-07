import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { JiraConnectionActions } from '@/components/admin/settings/integrations/jira/jira-connection-actions'
import { JiraConfig } from '@/components/admin/settings/integrations/jira/jira-config'
import { Button } from '@/components/ui/button'
import { jiraCatalog } from '@/lib/server/integrations/jira/catalog'

function JiraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="jira-grad-1" x1="98%" y1="0%" x2="58%" y2="42%">
          <stop offset="18%" stopColor="#0052CC" />
          <stop offset="100%" stopColor="#2684FF" />
        </linearGradient>
        <linearGradient id="jira-grad-2" x1="2%" y1="100%" x2="42%" y2="58%">
          <stop offset="18%" stopColor="#0052CC" />
          <stop offset="100%" stopColor="#2684FF" />
        </linearGradient>
      </defs>
      <path
        d="M11.53 2C11.53 4.4 13.5 6.35 15.88 6.35H17.66V8.05C17.66 10.45 19.6 12.4 22 12.4V2.84C22 2.38 21.62 2 21.16 2H11.53Z"
        fill="url(#jira-grad-1)"
      />
      <path
        d="M6.77 6.8C6.77 9.2 8.72 11.15 11.1 11.15H12.88V12.86C12.88 15.26 14.83 17.2 17.21 17.2V7.64C17.21 7.18 16.83 6.8 16.37 6.8H6.77Z"
        fill="url(#jira-grad-2)"
      />
      <path
        d="M2 11.6C2 14 3.95 15.95 6.33 15.95H8.12V17.66C8.12 20.06 10.07 22 12.45 22V12.44C12.45 11.98 12.07 11.6 11.61 11.6H2Z"
        fill="#2684FF"
      />
    </svg>
  )
}

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
