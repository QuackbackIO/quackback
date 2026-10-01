import { BuiltInToolsCard } from '@/components/admin/automation/builtin-tools-card'
import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { ChevronRightIcon, LinkIcon } from '@heroicons/react/24/outline'
import { AddConnectorDialog } from '@/components/admin/automation/connectors/add-connector-dialog'
import { UpdateBearerDialog } from '@/components/admin/automation/connectors/update-bearer-dialog'
import { ConnectorMark } from '@/components/admin/automation/connectors/connector-mark'
import { ConnectorStatusBadge } from '@/components/admin/automation/connectors/connector-status-badge'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { connectorQueries } from '@/lib/client/queries/assistant-connectors'
import { assistantQueries } from '@/lib/client/queries/assistant'
import {
  useRefreshConnector,
  useStartConnectorOAuth,
} from '@/lib/client/mutations/assistant-connectors'
import { toast } from 'sonner'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { warmQuery } from '@/lib/client/queries/warm-query'

export const Route = createFileRoute('/admin/settings/connectors')({
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.ASSISTANT_MANAGE)
  },
  loader: async ({ context }) => {
    const { queryClient } = context
    // The built-in tools card reads the agent settings and the tool catalogue.
    await Promise.all([
      queryClient.ensureQueryData(connectorQueries.list()),
      warmQuery(queryClient, assistantQueries.settings()),
      warmQuery(queryClient, assistantQueries.tools()),
    ])
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: ConnectorsPage,
})

function ConnectorsPage() {
  const intl = useIntl()
  const list = useQuery(connectorQueries.list())
  const [addOpen, setAddOpen] = useState(false)
  const [tokenConnectorId, setTokenConnectorId] = useState<string | null>(null)
  const refresh = useRefreshConnector()
  const startOAuth = useStartConnectorOAuth()
  const connectors = list.data?.connectors ?? []

  const addButton = (
    <NewButton noun="connector" onClick={() => setAddOpen(true)}>
      {intl.formatMessage({ id: 'automation.connectors.add', defaultMessage: 'New connector' })}
    </NewButton>
  )

  return (
    <SettingsPage
      page="/admin/settings/connectors"
      description={intl.formatMessage({
        id: 'automation.connectors.description',
        defaultMessage: 'Give Quinn tools from external MCP servers.',
      })}
      actions={addButton}
    >
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.connectors.loading',
            defaultMessage: 'Loading connectors…',
          })}
        </p>
      ) : list.isError ? (
        <p className="text-sm text-destructive">
          {intl.formatMessage({
            id: 'automation.connectors.loadError',
            defaultMessage: 'Could not load connectors.',
          })}
        </p>
      ) : (
        <SettingsCard flush>
          {connectors.length === 0 && (
            <EmptyState
              size="compact"
              icon={LinkIcon}
              title={intl.formatMessage({
                id: 'automation.connectors.empty.title',
                defaultMessage: 'No connectors yet',
              })}
              description={intl.formatMessage({
                id: 'automation.connectors.trust',
                defaultMessage:
                  'Connectors call external servers from your workspace. Only connect servers you trust.',
              })}
            />
          )}
          {connectors.map((connector, index) => (
            <Link
              key={connector.id}
              to="/admin/settings/connectors/$connectorId"
              params={{ connectorId: connector.id }}
              className={
                index === 0
                  ? 'flex items-center gap-3 px-4 py-3.5 hover:bg-foreground/[0.02] sm:px-[18px]'
                  : 'flex items-center gap-3 border-t border-border/60 px-4 py-3.5 hover:bg-foreground/[0.02] sm:px-[18px]'
              }
            >
              <ConnectorMark name={connector.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                  {connector.name}
                  <ConnectorStatusBadge status={connector.status} />
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {connector.status === 'error' && connector.lastError
                    ? connector.lastError
                    : `${connector.url} · ${connector.toolCount} tools`}
                </p>
              </div>
              {connector.status === 'error' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (connector.authMode === 'oauth') {
                      startOAuth.mutate(connector.id, {
                        onSuccess: (result) => {
                          window.location.assign(result.authorizationUrl)
                        },
                        onError: () => toast.error('Could not reconnect'),
                      })
                      return
                    }
                    if (connector.authMode === 'bearer') {
                      setTokenConnectorId(connector.id)
                      return
                    }
                    refresh.mutate(connector.id, {
                      onError: () => toast.error('Could not refresh the connection. Try again.'),
                    })
                  }}
                >
                  {connector.authMode === 'oauth'
                    ? intl.formatMessage({
                        id: 'automation.connectors.reconnect',
                        defaultMessage: 'Reconnect',
                      })
                    : connector.authMode === 'bearer'
                      ? intl.formatMessage({
                          id: 'automation.connectors.updateToken',
                          defaultMessage: 'Update token',
                        })
                      : intl.formatMessage({
                          id: 'automation.connectors.retry',
                          defaultMessage: 'Try again',
                        })}
                </Button>
              )}
              {connector.assignments.agent && <Badge size="sm">Agent</Badge>}
              {connector.assignments.copilot && <Badge size="sm">Copilot</Badge>}
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </SettingsCard>
      )}
      <BuiltInToolsCard />
      <AddConnectorDialog open={addOpen} onOpenChange={setAddOpen} />
      <UpdateBearerDialog
        connectorId={tokenConnectorId}
        open={tokenConnectorId !== null}
        onOpenChange={(open) => {
          if (!open) setTokenConnectorId(null)
        }}
      />
    </SettingsPage>
  )
}
