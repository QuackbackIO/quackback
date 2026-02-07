import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { IntercomConnectionActions } from '@/components/admin/settings/integrations/intercom/intercom-connection-actions'
import { Button } from '@/components/ui/button'
import { IntercomIcon } from '@/components/icons/integration-icons'
import { intercomCatalog } from '@/lib/server/integrations/intercom/catalog'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

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
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

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
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <IntercomConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
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
        <IntegrationSetupCard
          icon={<IntercomIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your Intercom account"
          description="Connect Intercom to enrich feedback with customer context like company, plan, and conversation history."
          steps={[
            <p key="1">
              Connect your Intercom account to authorize read-only access to contact data.
            </p>,
            <p key="2">
              When feedback is submitted by a known email, Quackback automatically looks up their
              Intercom profile.
            </p>,
            <p key="3">
              Customer context (company, plan, tags) appears alongside their feedback to help you
              prioritize.
            </p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <IntercomConnectionActions integrationId={undefined} isConnected={false} />
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="intercom"
          integrationName="Intercom"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
