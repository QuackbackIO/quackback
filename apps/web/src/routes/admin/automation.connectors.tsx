import { BuiltInToolsCard } from '@/components/admin/automation/builtin-tools-card'
import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { ChevronRightIcon, LinkIcon, PlusIcon } from '@heroicons/react/24/outline'
import { AddConnectorDialog } from '@/components/admin/automation/connectors/add-connector-dialog'
import { UpdateBearerDialog } from '@/components/admin/automation/connectors/update-bearer-dialog'
import { ConnectorMark } from '@/components/admin/automation/connectors/connector-mark'
import { ConnectorStatusBadge } from '@/components/admin/automation/connectors/connector-status-badge'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { BackLink } from '@/components/ui/back-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { connectorQueries } from '@/lib/client/queries/assistant-connectors'
import {
  useRefreshConnector,
  useStartConnectorOAuth,
} from '@/lib/client/mutations/assistant-connectors'
import { toast } from 'sonner'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

export const Route = createFileRoute('/admin/automation/connectors')({
  beforeLoad: ({ context }) => {
    const permissions = (context as { permissions?: PermissionKey[] }).permissions ?? []
    if (!permissions.includes(PERMISSIONS.ASSISTANT_MANAGE)) {
      throw new Error('Access denied: requires assistant.manage')
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(connectorQueries.list())
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">
          {intl.formatMessage({ id: 'automation.nav.label', defaultMessage: 'AI & Automation' })}
        </BackLink>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LinkIcon className="size-[18px]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">
              {intl.formatMessage({
                id: 'automation.connectors.title',
                defaultMessage: 'Connectors',
              })}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.connectors.description',
                defaultMessage:
                  'Give Quinn tools from external MCP servers. One catalog, mapped onto each agent.',
              })}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-4" />
          {intl.formatMessage({ id: 'automation.connectors.add', defaultMessage: 'Add connector' })}
        </Button>
      </div>

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
        <SettingsCard contentClassName="p-0">
          {connectors.map((connector, index) => (
            <Link
              key={connector.id}
              to="/admin/automation/connectors/$connectorId"
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
                      onError: () => toast.error('Could not retry'),
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
                          defaultMessage: 'Retry',
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
      <p className="text-xs text-muted-foreground">
        {intl.formatMessage({
          id: 'automation.connectors.trust',
          defaultMessage:
            'Connectors call external servers from your workspace. Only connect servers you trust.',
        })}
      </p>
      <BuiltInToolsCard agent="agent" />
      <BuiltInToolsCard agent="copilot" />
      <AddConnectorDialog open={addOpen} onOpenChange={setAddOpen} />
      <UpdateBearerDialog
        connectorId={tokenConnectorId}
        open={tokenConnectorId !== null}
        onOpenChange={(open) => {
          if (!open) setTokenConnectorId(null)
        }}
      />
    </div>
  )
}
