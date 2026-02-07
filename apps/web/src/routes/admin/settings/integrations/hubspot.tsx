import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { HubSpotConnectionActions } from '@/components/admin/settings/integrations/hubspot/hubspot-connection-actions'
import { Button } from '@/components/ui/button'
import { HubSpotIcon } from '@/components/icons/integration-icons'
import { hubspotCatalog } from '@/lib/server/integrations/hubspot/catalog'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

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
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

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
          <div className="flex items-center gap-2">
            {platformCredentialFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                Configure credentials
              </Button>
            )}
            {platformCredentialsConfigured && (
              <HubSpotConnectionActions
                integrationId={integration?.id}
                isConnected={isConnected || isPaused}
              />
            )}
          </div>
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

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="hubspot"
          integrationName="HubSpot"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
