import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { GitLabConnectionActions } from '@/components/admin/settings/integrations/gitlab/gitlab-connection-actions'
import { GitLabConfig } from '@/components/admin/settings/integrations/gitlab/gitlab-config'
import { GitLabIcon } from '@/components/icons/integration-icons'
import { gitlabCatalog } from '@/lib/server/integrations/gitlab/catalog'

export const Route = createFileRoute('/admin/settings/integrations/gitlab')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('gitlab'))
    return {}
  },
  component: GitLabIntegrationPage,
})

function GitLabIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('gitlab'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={gitlabCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<GitLabIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <GitLabConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <GitLabConfig
            integrationId={integration.id}
            initialConfig={(integration.config ?? {}) as { channelId?: string }}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<GitLabIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect GitLab"
          description="Connect GitLab to automatically create issues from feedback and sync statuses between platforms."
          steps={[
            <p key="1">
              Configure your GitLab{' '}
              <span className="font-medium text-foreground">OAuth application credentials</span> in
              the platform settings.
            </p>,
            <p key="2">
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback with your GitLab account.
            </p>,
            <p key="3">
              Select a project to create issues in, then choose which events should trigger new
              issues.
            </p>,
          ]}
          connectionForm={<GitLabConnectionActions integrationId={undefined} isConnected={false} />}
        />
      )}
    </div>
  )
}
