import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { ChevronRightIcon, LinkIcon, PlusIcon } from '@heroicons/react/24/outline'
import { AddConnectorDialog } from '@/components/admin/automation/connectors/add-connector-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { connectorQueries } from '@/lib/client/queries/assistant-connectors'
import {
  useRefreshConnector,
  useStartConnectorOAuth,
} from '@/lib/client/mutations/assistant-connectors'
import { toast } from 'sonner'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { ConnectorDTO } from '@/lib/shared/assistant/connectors'

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

function statusBadge(connector: ConnectorDTO) {
  if (connector.status === 'connected') {
    return (
      <Badge size="sm" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        Connected
      </Badge>
    )
  }
  if (connector.status === 'error') {
    return (
      <Badge size="sm" className="bg-amber-500/10 text-amber-800 dark:text-amber-300">
        Needs attention
      </Badge>
    )
  }
  return <Badge size="sm">Disabled</Badge>
}

function ConnectorsPage() {
  const intl = useIntl()
  const list = useQuery(connectorQueries.list())
  const [addOpen, setAddOpen] = useState(false)
  const refresh = useRefreshConnector()
  const startOAuth = useStartConnectorOAuth()
  const builtin = list.data?.builtin
  const connectors = list.data?.connectors ?? []

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LinkIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">
              {intl.formatMessage({
                id: 'automation.connectors.title',
                defaultMessage: 'Connectors',
              })}
            </h1>
            <p className="text-sm text-muted-foreground">
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

      <SettingsCard>
        {builtin && (
          <Link
            to="/admin/automation/connectors/$connectorId"
            params={{ connectorId: 'quackback' }}
            className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-foreground/[0.02]"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-400 text-xs font-semibold text-amber-950">
              Q
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Quackback</span>
                <Badge size="sm">Built-in</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {intl.formatMessage(
                  {
                    id: 'automation.connectors.builtin.sub',
                    defaultMessage:
                      '{count} built-in actions · search, tickets, feedback, attributes',
                  },
                  { count: builtin.tools.length }
                )}
              </p>
            </div>
            <Badge size="sm">Agent</Badge>
            <Badge size="sm">Copilot</Badge>
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Link>
        )}
        {connectors.map((connector) => (
          <Link
            key={connector.id}
            to="/admin/automation/connectors/$connectorId"
            params={{ connectorId: connector.id }}
            className="flex items-center gap-3 border-t border-border/60 py-3 hover:bg-foreground/[0.02]"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
              {connector.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{connector.name}</span>
                {statusBadge(connector)}
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {connector.url} · {connector.toolCount} tools
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
                  refresh.mutate(connector.id, {
                    onError: () => toast.error('Could not reconnect'),
                  })
                }}
              >
                Reconnect
              </Button>
            )}
            {connector.assignments.agent && <Badge size="sm">Agent</Badge>}
            {connector.assignments.copilot && <Badge size="sm">Copilot</Badge>}
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </SettingsCard>
      <p className="text-xs text-muted-foreground">
        {intl.formatMessage({
          id: 'automation.connectors.trust',
          defaultMessage:
            'Connectors call external servers from your workspace. Only connect servers you trust.',
        })}
      </p>
      <AddConnectorDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  )
}
