import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntercomConnectionActions } from '@/components/admin/settings/integrations/intercom/intercom-connection-actions'
import { intercomCatalog } from '@/lib/server/integrations/intercom/catalog'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

function IntercomIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1 17.5c0 .276-.224.5-.5.5s-.5-.224-.5-.5v-4c0-.276.224-.5.5-.5s.5.224.5.5v4zm-3 0c0 .276-.224.5-.5.5s-.5-.224-.5-.5v-3c0-.276.224-.5.5-.5s.5.224.5.5v3zm6 0c0 .276-.224.5-.5.5s-.5-.224-.5-.5v-4c0-.276.224-.5.5-.5s.5.224.5.5v4zm3 0c0 .276-.224.5-.5.5s-.5-.224-.5-.5v-3c0-.276.224-.5.5-.5s.5.224.5.5v3zm3-1c0 .276-.224.5-.5.5s-.5-.224-.5-.5v-2c0-.276.224-.5.5-.5s.5.224.5.5v2zm-15 0c0 .276-.224.5-.5.5S4 16.776 4 16.5v-2c0-.276.224-.5.5-.5s.5.224.5.5v2zm14 3.5c-.157 0-.312-.073-.412-.21C18.137 19.142 15.354 18 12 18s-6.137 1.142-6.588 1.79a.501.501 0 01-.824-.58C5.16 18.38 8.24 17 12 17s6.84 1.38 7.412 2.21a.5.5 0 01-.412.79z" />
    </svg>
  )
}

export const Route = createFileRoute('/admin/settings/integrations/intercom')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('intercom'))
    return {}
  },
  component: IntercomIntegrationPage,
})

function IntercomIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('intercom'))
  const integration = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={intercomCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<IntercomIcon className="h-6 w-6 text-white" />}
        actions={
          <IntercomConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
          />
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
            <p className="text-sm text-foreground">
              Intercom enrichment is active. Customer data from Intercom will automatically appear
              alongside feedback from known contacts.
            </p>
          </div>
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <IntercomIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Intercom account</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Intercom to enrich feedback with customer context like company, plan, and
            conversation history.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium text-foreground">How it works</h2>
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              1
            </span>
            <p>Connect your Intercom account to authorize read-only access to contact data.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              When feedback is submitted by a known email, Quackback automatically looks up their
              Intercom profile.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Customer context (company, plan, tags) appears alongside their feedback to help you
              prioritize.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
