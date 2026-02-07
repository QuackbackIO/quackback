import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { ZendeskConnectionActions } from '@/components/admin/settings/integrations/zendesk/zendesk-connection-actions'
import { Button } from '@/components/ui/button'
import { ZendeskIcon } from '@/components/icons/integration-icons'
import { zendeskCatalog } from '@/lib/server/integrations/zendesk/catalog'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

export const Route = createFileRoute('/admin/settings/integrations/zendesk')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('zendesk'))
    return {}
  },
  component: ZendeskIntegrationPage,
})

function ZendeskIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('zendesk'))
  const { integration, platformCredentialFields, platformCredentialsConfigured } =
    integrationQuery.data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={zendeskCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<ZendeskIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <ZendeskConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
            <p className="text-sm text-foreground">
              Zendesk enrichment is active. Support ticket data will automatically appear alongside
              feedback from known contacts.
            </p>
          </div>
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<ZendeskIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your Zendesk account"
          description="Connect Zendesk to enrich feedback with support context like organization, tags, and ticket history."
          steps={[
            <p key="1">
              Connect your Zendesk account to authorize read-only access to user and ticket data.
            </p>,
            <p key="2">
              When feedback is submitted by a known email, Quackback looks up their Zendesk profile.
            </p>,
            <p key="3">
              Support context (organization, ticket history) appears alongside their feedback.
            </p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <ZendeskConnectionActions integrationId={undefined} isConnected={false} />
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="zendesk"
          integrationName="Zendesk"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
