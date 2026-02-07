import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { ZendeskConnectionActions } from '@/components/admin/settings/integrations/zendesk/zendesk-connection-actions'
import { Button } from '@/components/ui/button'
import { zendeskCatalog } from '@/lib/server/integrations/zendesk/catalog'
import { CheckCircleIcon } from '@heroicons/react/24/solid'

function ZendeskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.086 0v17.023L0 20.345V0h11.086zm0 6.955C11.086 3.113 8.638.665 4.796.665v6.29h6.29zM12.914 24V6.977L24 3.655V24H12.914zm0-6.955c0 3.842 2.448 6.29 6.29 6.29v-6.29h-6.29z" />
    </svg>
  )
}

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
          <div className="flex items-center gap-2">
            {platformCredentialFields.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                Configure credentials
              </Button>
            )}
            {platformCredentialsConfigured && (
              <ZendeskConnectionActions
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
              Zendesk enrichment is active. Support ticket data will automatically appear alongside
              feedback from known contacts.
            </p>
          </div>
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <ZendeskIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect your Zendesk account</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Zendesk to enrich feedback with support context like organization, tags, and
            ticket history.
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
              Connect your Zendesk account to authorize read-only access to user and ticket data.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              When feedback is submitted by a known email, Quackback looks up their Zendesk profile.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>Support context (organization, ticket history) appears alongside their feedback.</p>
          </div>
        </div>
      </div>

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
