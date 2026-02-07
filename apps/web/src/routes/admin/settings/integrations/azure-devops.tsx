import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
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
          isConnected || isPaused ? (
            <AzureDevOpsConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
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
        <IntegrationSetupCard
          icon={<AzureDevOpsIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Azure DevOps"
          description="Connect Azure DevOps to automatically create work items from feedback posts, keeping your team's workflow in sync."
          steps={[
            <p key="1">
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
            </p>,
            <p key="2">
              Enter your organization URL and PAT below, then click{' '}
              <span className="font-medium text-foreground">Connect</span>. Quackback will verify
              access to your organization.
            </p>,
            <p key="3">
              Select which project and work item type to use, then enable the events that should
              trigger work item creation.
            </p>,
          ]}
          connectionForm={
            <AzureDevOpsConnectionActions integrationId={undefined} isConnected={false} />
          }
        />
      )}
    </div>
  )
}
