import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { HubSpotConnectionActions } from '@/components/admin/settings/integrations/hubspot/hubspot-connection-actions'
import { hubspotCatalog } from '@/lib/server/integrations/hubspot/catalog'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

function HubSpotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.984v-.066A2.2 2.2 0 0017.235.838h-.066a2.2 2.2 0 00-2.196 2.196v.066c0 .868.507 1.617 1.24 1.974v2.862a6.22 6.22 0 00-2.94 1.475l-7.755-6.03a2.636 2.636 0 00.07-.592C5.588 1.256 4.332 0 2.794 0S0 1.256 0 2.794s1.256 2.794 2.794 2.794c.56 0 1.08-.168 1.517-.453l7.63 5.935a6.254 6.254 0 00-.913 3.253c0 1.2.34 2.32.928 3.27l-2.874 2.876a2.123 2.123 0 00-.618-.098c-1.17 0-2.12.95-2.12 2.12 0 1.17.95 2.12 2.12 2.12 1.17 0 2.12-.95 2.12-2.12 0-.22-.036-.43-.098-.63l2.846-2.846a6.268 6.268 0 003.86 1.328c3.461 0 6.27-2.81 6.27-6.27a6.27 6.27 0 00-4.298-5.952zM17.2 19.468a3.74 3.74 0 01-3.737-3.736 3.74 3.74 0 013.736-3.737 3.74 3.74 0 013.737 3.737 3.74 3.74 0 01-3.737 3.736z" />
    </svg>
  )
}

export const Route = createFileRoute('/admin/settings/integrations/hubspot')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('hubspot'))
    return {}
  },
  component: HubSpotIntegrationPage,
})

function HubSpotIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('hubspot'))
  const integration = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={hubspotCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<HubSpotIcon className="h-6 w-6 text-white" />}
        actions={
          <HubSpotConnectionActions
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
              HubSpot enrichment is active. CRM data will automatically appear alongside feedback
              from known contacts.
            </p>
          </div>
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <HubSpotIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your HubSpot account</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect HubSpot to enrich feedback with CRM context like company, deal value, and
            lifecycle stage.
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
            <p>
              Connect your HubSpot account to authorize read-only access to contact and deal data.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              When feedback is submitted by a known email, Quackback looks up their HubSpot profile.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              CRM context (company, deal value, lifecycle stage) appears alongside their feedback to
              help you prioritize by revenue impact.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
