import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { AsanaConnectionActions } from '@/components/admin/settings/integrations/asana/asana-connection-actions'
import { AsanaConfig } from '@/components/admin/settings/integrations/asana/asana-config'
import { asanaCatalog } from '@/lib/server/integrations/asana/catalog'

function AsanaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="6.5" r="3.5" />
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
    </svg>
  )
}

export const Route = createFileRoute('/admin/settings/integrations/asana')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('asana'))
    return {}
  },
  component: AsanaIntegrationPage,
})

function AsanaIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('asana'))
  const integration = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={asanaCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<AsanaIcon className="h-6 w-6 text-white" />}
        actions={
          <AsanaConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
          />
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <AsanaConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <AsanaIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Asana workspace</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Asana to automatically create tasks from feedback and keep statuses in sync
            across both platforms.
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
              Quackback to create tasks in your Asana workspace.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>Select which project new feedback tasks should be created in.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Choose which events trigger task creation. You can change these settings at any time.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
