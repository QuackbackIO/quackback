import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { ClickUpConnectionActions } from '@/components/admin/settings/integrations/clickup/clickup-connection-actions'
import { ClickUpConfig } from '@/components/admin/settings/integrations/clickup/clickup-config'
import { clickupCatalog } from '@/lib/server/integrations/clickup/catalog'

function ClickUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="clickup-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8930FD" />
          <stop offset="50%" stopColor="#49CCF9" />
          <stop offset="100%" stopColor="#49CCF9" />
        </linearGradient>
      </defs>
      <path
        d="M4 16.5L7.5 13.8C8.9 15.6 10.4 16.5 12 16.5C13.6 16.5 15.1 15.6 16.5 13.8L20 16.5C18 19.2 15.3 20.7 12 20.7C8.7 20.7 6 19.2 4 16.5Z"
        fill="url(#clickup-grad)"
      />
      <path
        d="M4 12.3L7.5 9.6C8.9 11.4 10.4 12.3 12 12.3C13.6 12.3 15.1 11.4 16.5 9.6L20 12.3C18 15 15.3 16.5 12 16.5C8.7 16.5 6 15 4 12.3Z"
        fill="url(#clickup-grad)"
        opacity="0.4"
      />
      <path d="M12 3.3L5 9.5L7.4 12.3L12 8.3L16.6 12.3L19 9.5L12 3.3Z" fill="url(#clickup-grad)" />
    </svg>
  )
}

export const Route = createFileRoute('/admin/settings/integrations/clickup')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('clickup'))
    return {}
  },
  component: ClickUpIntegrationPage,
})

function ClickUpIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('clickup'))
  const integration = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={clickupCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<ClickUpIcon className="h-6 w-6" />}
        actions={
          <ClickUpConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
          />
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <ClickUpConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <ClickUpIcon className="mx-auto h-10 w-10" />
          <h3 className="mt-4 font-medium text-foreground">Connect your ClickUp workspace</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect ClickUp to turn feedback into tasks and track progress directly from your
            workspace.
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
              Quackback to create tasks in your ClickUp workspace.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>Select a space and list where new feedback tasks should be created.</p>
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
