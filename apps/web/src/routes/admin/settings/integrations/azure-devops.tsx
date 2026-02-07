import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { AzureDevOpsConnectionActions } from '@/components/admin/settings/integrations/azure-devops/azure-devops-connection-actions'
import { AzureDevOpsConfig } from '@/components/admin/settings/integrations/azure-devops/azure-devops-config'
import { AzureDevOpsIcon } from '@/components/icons/integration-icons'
import { azureDevOpsCatalog } from '@/lib/server/integrations/azure-devops/catalog'

export const Route = createFileRoute('/admin/settings/integrations/azure-devops')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('azure_devops'))
    return {}
  },
  component: AzureDevOpsIntegrationPage,
})

function AzureDevOpsIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('azure_devops'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={azureDevOpsCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={
          (integration?.config as { organizationName?: string })?.organizationName ?? undefined
        }
        icon={<AzureDevOpsIcon className="h-6 w-6" />}
        actions={
          <AzureDevOpsConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
          />
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <AzureDevOpsConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <AzureDevOpsIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect Azure DevOps</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Azure DevOps to automatically create work items from feedback posts, keeping
            your team's workflow in sync.
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
              Create a{' '}
              <a
                href="https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-2"
              >
                Personal Access Token
              </a>{' '}
              in Azure DevOps with{' '}
              <span className="font-medium text-foreground">Work Items (Read & Write)</span> scope.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              Enter your organization URL and PAT above, then click{' '}
              <span className="font-medium text-foreground">Connect</span>. Quackback will verify
              access to your organization.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Select which project and work item type to use, then enable the events that should
              trigger work item creation.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
