import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { ShortcutConnectionActions } from '@/components/admin/settings/integrations/shortcut/shortcut-connection-actions'
import { ShortcutConfig } from '@/components/admin/settings/integrations/shortcut/shortcut-config'
import { ShortcutIcon } from '@/components/icons/integration-icons'
import { shortcutCatalog } from '@/lib/server/integrations/shortcut/catalog'

export const Route = createFileRoute('/admin/settings/integrations/shortcut')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('shortcut'))
    return {}
  },
  component: ShortcutIntegrationPage,
})

function ShortcutIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('shortcut'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={shortcutCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<ShortcutIcon className="h-6 w-6 text-white" />}
        actions={
          <ShortcutConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
          />
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <ShortcutConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <ShortcutIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Shortcut workspace</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Shortcut to automatically create stories from feedback and keep statuses in sync
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
            <p>Generate an API token from your Shortcut account settings and paste it above.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>Select which project new feedback stories should be created in.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Choose which events trigger story creation. You can change these settings at any time.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
