import { Suspense, useEffect, useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import {
  IntegrationHealthPanel,
  type IntegrationHealth,
} from '@/components/admin/settings/integrations/integration-health-panel'
import {
  getIntegrationSettingsEntry,
  type IntegrationSettingsData,
} from '@/components/admin/settings/integrations/integration-settings-registry'
import { IntegrationSyncHistory } from '@/components/admin/settings/integrations/integration-sync-history'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { canEditPlatformCredentials, showOAuthConnect } from '@/lib/shared/integration-connect'

/** URL segments use hyphens (e.g. `azure-devops`); registry keys use the
 * underscore integration type (`azure_devops`). Every other provider is a
 * single token, so a blanket hyphen→underscore swap is safe. */
function toIntegrationType(param: string): string {
  return param.replace(/-/g, '_')
}

const emptyHealth: IntegrationHealth = {
  lastOutboundAt: null,
  lastInboundAt: null,
  lastError: null,
  lastErrorAt: null,
  attentionCount: 0,
}

export const Route = createFileRoute('/admin/settings/integrations/$type')({
  validateSearch: (search: Record<string, unknown>): { tab?: 'history' } => ({
    tab: search.tab === 'history' ? 'history' : undefined,
  }),
  loader: async ({ context, params }) => {
    const type = toIntegrationType(params.type)
    // Loaded on demand: a static import would put every provider's settings
    // UI in the route module, which every page loads eagerly.
    const { getIntegrationSettingsEntry } =
      await import('@/components/admin/settings/integrations/integration-settings-registry')
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
  const {
    platformCredentialFields,
    platformCredentialsConfigured,
    platformCredentialsManaged = false,
  } = data
  const historyAvailable = data.syncHistoryAvailable === true
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  useEffect(() => {
    if (tab !== 'history') return
    if (historyAvailable) setHistoryOpen(true)
    void navigate({
      search: (previous) => ({ ...previous, tab: undefined }),
      replace: true,
    })
  }, [tab, historyAvailable, navigate])

  useEffect(() => {
    if (!historyAvailable) setHistoryOpen(false)
  }, [historyAvailable])

  const { catalog, Icon, ConnectionActions, setup } = entry
  const status = integration?.status ?? null
  const isConnected = status === 'active'
  const isPaused = status === 'paused'
  const hasCredentials = platformCredentialFields.length > 0
  const canEditCredentials = canEditPlatformCredentials(platformCredentialsManaged)
  const canConnect = showOAuthConnect({
    hasPlatformCredentialFields: hasCredentials,
    platformCredentialsConfigured,
    platformCredentialsManaged,
  })
  const workspaceName = integration
    ? (entry.getWorkspaceName?.(integration) ?? integration.workspaceName)
    : undefined
  const showDisconnect = isConnected || isPaused
  const showConnect = !integration && canConnect
  const showCredentials = hasCredentials && canEditCredentials && (showDisconnect || !integration)
  const credentialsPrimary = showCredentials && !showDisconnect && !showConnect
  const health = integration?.health
    ? {
        ...integration.health,
        attentionCount: historyAvailable ? (integration.health.attentionCount ?? 0) : 0,
      }
    : emptyHealth

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={catalog}
        status={status}
        workspaceName={workspaceName}
        icon={<Icon className="h-6 w-6 text-white" />}
        aside={
          <IntegrationHealthPanel
            embedded
            health={health}
            onViewHistory={historyAvailable ? () => setHistoryOpen(true) : undefined}
            actions={
              showCredentials || showDisconnect || showConnect ? (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {showCredentials && (
                    <Button
                      variant={credentialsPrimary ? 'default' : 'outline'}
                      size={credentialsPrimary ? 'default' : 'sm'}
                      onClick={() => setCredentialsOpen(true)}
                    >
                      Configure credentials
                    </Button>
                  )}
                  {(showDisconnect || showConnect) && (
                    <Suspense fallback={null}>
                      <ConnectionActions
                        integrationId={integration?.id}
                        isConnected={showDisconnect}
                      />
                    </Suspense>
                  )}
                </div>
              ) : undefined
            }
          />
        }
      />

      {integration && (isConnected || isPaused) && entry.renderConfig && (
        <div
          className={
            entry.bareConfig
              ? undefined
              : 'rounded-xl border border-border/50 bg-card p-6 shadow-sm'
          }
        >
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            {entry.renderConfig({ integration, isConnected })}
          </Suspense>
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<Icon className="h-6 w-6 text-muted-foreground" />}
          title={setup.title}
          description={setup.description}
          steps={setup.steps}
        />
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[min(80vh,720px)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sync history</DialogTitle>
          </DialogHeader>
          {historyOpen && <IntegrationSyncHistory key={type} provider={type} />}
        </DialogContent>
      </Dialog>

      {hasCredentials && canEditCredentials && (
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
