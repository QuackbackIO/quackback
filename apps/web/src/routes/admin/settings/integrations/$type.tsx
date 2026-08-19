import { Suspense, useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { IntegrationHealthPanel } from '@/components/admin/settings/integrations/integration-health-panel'
import {
  getIntegrationSettingsEntry,
  type IntegrationSettingsData,
} from '@/components/admin/settings/integrations/integration-settings-registry'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** URL segments use hyphens (e.g. `azure-devops`); registry keys use the
 * underscore integration type (`azure_devops`). Every other provider is a
 * single token, so a blanket hyphen→underscore swap is safe. */
function toIntegrationType(param: string): string {
  return param.replace(/-/g, '_')
}

export const Route = createFileRoute('/admin/settings/integrations/$type')({
  loader: async ({ context, params }) => {
    const type = toIntegrationType(params.type)
    if (!getIntegrationSettingsEntry(type)) throw notFound()
    await context.queryClient.ensureQueryData(adminQueries.integrationByType(type))
    return {}
  },
  component: IntegrationSettingsPage,
})

function IntegrationSettingsPage() {
  const { type: param } = Route.useParams()
  const type = toIntegrationType(param)
  const entry = getIntegrationSettingsEntry(type)
  if (!entry) throw notFound()

  const { data } = useSuspenseQuery(adminQueries.integrationByType(type))
  const integration = data.integration as IntegrationSettingsData | null
  const { platformCredentialFields, platformCredentialsConfigured } = data
  const [credentialsOpen, setCredentialsOpen] = useState(false)

  const { catalog, Icon, ConnectionActions, setup } = entry
  const status = integration?.status ?? null
  const isConnected = status === 'active'
  const isPaused = status === 'paused'
  const hasCredentials = platformCredentialFields.length > 0
  const workspaceName = integration
    ? (entry.getWorkspaceName?.(integration) ?? integration.workspaceName)
    : undefined

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={catalog}
        status={status}
        workspaceName={workspaceName}
        icon={<Icon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <div className="flex items-center gap-2">
              {hasCredentials && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              <ConnectionActions integrationId={integration?.id} isConnected={true} />
            </div>
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <>
          <IntegrationHealthPanel health={integration.health} />
          {entry.renderConfig ? (
            <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
              <Suspense fallback={<Skeleton className="h-40 w-full" />}>
                {entry.renderConfig({ integration, isConnected })}
              </Suspense>
            </div>
          ) : (
            entry.connectedBanner
          )}
        </>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<Icon className="h-6 w-6 text-muted-foreground" />}
          title={setup.title}
          description={setup.description}
          steps={setup.steps}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {hasCredentials && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {(!hasCredentials || platformCredentialsConfigured) && (
                <div className="flex items-center gap-2">
                  {hasCredentials && (
                    <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                      Configure credentials
                    </Button>
                  )}
                  <Suspense fallback={null}>
                    <ConnectionActions integrationId={undefined} isConnected={false} />
                  </Suspense>
                </div>
              )}
            </div>
          }
        />
      )}

      {hasCredentials && (
        <PlatformCredentialsDialog
          integrationType={type}
          integrationName={catalog.name}
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}
    </div>
  )
}
