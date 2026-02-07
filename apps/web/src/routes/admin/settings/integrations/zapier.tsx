import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { ZapierConnectionActions } from '@/components/admin/settings/integrations/zapier/zapier-connection-actions'
import { ZapierConfig } from '@/components/admin/settings/integrations/zapier/zapier-config'
import { zapierCatalog } from '@/lib/server/integrations/zapier/catalog'

function ZapierIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.535 8.465l-1.406 1.406a5.02 5.02 0 010 4.258l1.406 1.406a7.007 7.007 0 000-7.07zm-2.12 2.12a3.01 3.01 0 010 2.83L12 12l1.415-1.415zM12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 110-16 8 8 0 010 16z" />
      <path d="M14.828 5.757l-1.414 1.414 1.06 1.06a7.12 7.12 0 010 7.538l-1.06 1.06 1.414 1.414 1.06-1.06a9.15 9.15 0 000-9.366l-1.06-1.06zM9.172 5.757L8.11 6.818a9.15 9.15 0 000 9.364l1.06 1.06 1.415-1.413-1.06-1.06a7.12 7.12 0 010-7.54l1.06-1.058L9.17 5.757z" />
    </svg>
  )
}

export const Route = createFileRoute('/admin/settings/integrations/zapier')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('zapier'))
    return {}
  },
  component: ZapierIntegrationPage,
})

function ZapierIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('zapier'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={zapierCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<ZapierIcon className="h-6 w-6 text-white" />}
        actions={
          <ZapierConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
            webhookUrl={integration?.config?.webhookUrl as string | undefined}
          />
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <ZapierConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <ZapierIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect Zapier</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Zapier to trigger automated workflows when users submit feedback, when statuses
            change, and when comments are added.
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
              Create a new Zap in Zapier and add a{' '}
              <span className="font-medium text-foreground">Webhooks by Zapier</span> trigger with{' '}
              <span className="font-medium text-foreground">Catch Hook</span>.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              Copy the webhook URL from Zapier and paste it above, then click{' '}
              <span className="font-medium text-foreground">Save</span>. Quackback will send a test
              payload.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Choose which events should trigger your Zap, then continue building your workflow in
              Zapier.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
