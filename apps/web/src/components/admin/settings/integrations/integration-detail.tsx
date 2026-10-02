import { Suspense, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { IntegrationSetupCard } from './integration-setup-card'
import { PlatformCredentialsDialog } from './platform-credentials-dialog'
import { IntegrationHealthPanel, type IntegrationHealth } from './integration-health-panel'
import type {
  IntegrationSettingsData,
  IntegrationSettingsEntry,
} from './integration-settings-registry'
import { IntegrationSyncHistory } from './integration-sync-history'
import { StateBadge } from '@/components/shared/state-badge'
import { Button } from '@/components/ui/button'
import { DocsLink } from '@/components/ui/docs-link'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { canEditPlatformCredentials, showOAuthConnect } from '@/lib/shared/integration-connect'
import type { PlatformCredentialField } from '@/lib/shared/integration-types'

const emptyHealth: IntegrationHealth = {
  lastOutboundAt: null,
  lastInboundAt: null,
  lastError: null,
  lastErrorAt: null,
  attentionCount: 0,
}

interface IntegrationDetailProps {
  /** The underscore integration type (`azure_devops`). */
  type: string
  entry: IntegrationSettingsEntry
  data: {
    integration: unknown
    platformCredentialFields: PlatformCredentialField[]
    platformCredentialsConfigured: boolean
    platformCredentialsManaged?: boolean
    syncHistoryAvailable?: boolean
  }
  /** The URL asked for the sync history dialog. */
  historyRequested: boolean
  /** Called once the request has been consumed so the URL can drop it. */
  onHistoryHandled: () => void
}

/**
 * One integration's page: the standard header with the connect action on the
 * right, the connected-state panels (Health, configuration) and, before it is
 * connected, the setup steps.
 */
export function IntegrationDetail({
  type,
  entry,
  data,
  historyRequested,
  onHistoryHandled,
}: IntegrationDetailProps) {
  const integration = data.integration as IntegrationSettingsData | null
  const {
    platformCredentialFields,
    platformCredentialsConfigured,
    platformCredentialsManaged = false,
  } = data
  const historyAvailable = data.syncHistoryAvailable === true
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    if (!historyRequested) return
    if (historyAvailable) setHistoryOpen(true)
    onHistoryHandled()
  }, [historyRequested, historyAvailable, onHistoryHandled])

  useEffect(() => {
    if (!historyAvailable) setHistoryOpen(false)
  }, [historyAvailable])

  const { catalog, Icon, ConnectionActions, setup } = entry
  const status = integration?.status ?? null
  // A connect that finishes here swaps the setup card for the connected
  // panels, so the form that ran it unmounts before it can report success.
  const hadIntegration = useRef(integration !== null)
  useEffect(() => {
    if (!hadIntegration.current && status === 'active') toast.success('Connected successfully')
    hadIntegration.current = integration !== null
  }, [integration, status])
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
  // A connect that needs typed input lives in the setup card; a one-click
  // connect is the header's primary action.
  const connectInSetup = entry.connectForm === true && !integration
  const health = integration?.health
    ? {
        ...integration.health,
        attentionCount: historyAvailable ? (integration.health.attentionCount ?? 0) : 0,
      }
    : emptyHealth

  const description =
    (workspaceName ? `Connected to ${workspaceName}` : null) || catalog.description

  const connection = (
    <Suspense fallback={null}>
      <ConnectionActions integrationId={integration?.id} isConnected={showDisconnect} />
    </Suspense>
  )

  return (
    <SettingsPage
      title={catalog.name}
      description={description}
      crumbs={[{ label: 'Integrations', to: '/admin/settings/integrations' }]}
      logo={
        <div
          className={`flex size-6 shrink-0 items-center justify-center rounded-md ${catalog.iconBg}`}
        >
          <Icon className="size-3.5 text-white" />
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {isPaused && <StateBadge state="off" />}
          {catalog.docsUrl && (
            <DocsLink href={catalog.docsUrl} className="text-[13px] text-muted-foreground">
              Learn how to set up {catalog.name}
            </DocsLink>
          )}
          {showCredentials && (
            <Button
              variant={credentialsPrimary ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCredentialsOpen(true)}
            >
              Configure credentials
            </Button>
          )}
          {(showDisconnect || showConnect) && !connectInSetup && connection}
        </div>
      }
    >
      {integration && status !== 'pending' && (
        <SettingsCard>
          <IntegrationHealthPanel
            embedded
            health={health}
            onViewHistory={historyAvailable ? () => setHistoryOpen(true) : undefined}
          />
        </SettingsCard>
      )}

      {integration && (isConnected || isPaused) && entry.renderConfig && (
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          {entry.bareConfig ? (
            entry.renderConfig({ integration, isConnected })
          ) : (
            <SettingsCard>{entry.renderConfig({ integration, isConnected })}</SettingsCard>
          )}
        </Suspense>
      )}

      {!integration && (
        <IntegrationSetupCard
          title={setup.title}
          description={setup.description}
          steps={setup.steps}
          connectionForm={connectInSetup && showConnect ? connection : undefined}
        />
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[min(80vh,720px)] sm:max-w-3xl overflow-y-auto">
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
    </SettingsPage>
  )
}
