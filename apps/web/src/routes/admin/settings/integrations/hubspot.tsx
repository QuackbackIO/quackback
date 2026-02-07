import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
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
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <HubSpotConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
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
        <IntegrationSetupCard
          icon={<HubSpotIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your HubSpot account"
          description="Connect HubSpot to enrich feedback with CRM context like company, deal value, and lifecycle stage."
          steps={[
            <p key="1">
              Connect your HubSpot account to authorize read-only access to contact and deal data.
            </p>,
            <p key="2">
              When feedback is submitted by a known email, Quackback looks up their HubSpot profile.
            </p>,
            <p key="3">
              CRM context (company, deal value, lifecycle stage) appears alongside their feedback to
              help you prioritize by revenue impact.
            </p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <HubSpotConnectionActions integrationId={undefined} isConnected={false} />
              )}
            </div>
          }
        />
      )}

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
