import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { ShortcutConnectionActions } from '@/components/admin/settings/integrations/shortcut/shortcut-connection-actions'
import { ShortcutConfig } from '@/components/admin/settings/integrations/shortcut/shortcut-config'
import { shortcutCatalog } from '@/lib/server/integrations/shortcut/catalog'

function ShortcutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.5 3C4.567 3 3 4.567 3 6.5v11C3 19.433 4.567 21 6.5 21h11c1.933 0 3.5-1.567 3.5-3.5v-11C21 4.567 19.433 3 17.5 3h-11zm3.25 4.5a1 1 0 0 1 .832.445l1.418 2.127 1.418-2.127a1 1 0 0 1 1.664 0l2.5 3.75a1 1 0 0 1-.832 1.555H13.5l1.918 2.877a1 1 0 0 1-1.664 1.11L12 14.862l-1.754 2.376a1 1 0 1 1-1.664-1.11L10.5 13.25H7.25a1 1 0 0 1-.832-1.555l2.5-3.75a1 1 0 0 1 .832-.445z" />
    </svg>
  )
}

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
