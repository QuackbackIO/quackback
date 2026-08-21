import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { ConnectorMark } from '@/components/admin/automation/connectors/connector-mark'
import { ConnectorStatusBadge } from '@/components/admin/automation/connectors/connector-status-badge'
import {
  PolicyDefaultSelect,
  PolicyDial,
} from '@/components/admin/automation/connectors/policy-dial'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { BackLink } from '@/components/ui/back-link'
import { connectorQueries } from '@/lib/client/queries/assistant-connectors'
import {
  useDeleteConnector,
  useRefreshConnector,
  useUpdateConnector,
} from '@/lib/client/mutations/assistant-connectors'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { ConnectorToolDTO, ConnectorToolPolicy } from '@/lib/shared/assistant/connectors'
import { useState } from 'react'

// Trailing underscore on "connectors_" escapes nesting under the list route,
// which has no Outlet. URL stays /admin/automation/connectors/:connectorId.
export const Route = createFileRoute('/admin/automation/connectors_/$connectorId')({
  beforeLoad: ({ context }) => {
    const permissions = (context as { permissions?: PermissionKey[] }).permissions ?? []
    if (!permissions.includes(PERMISSIONS.ASSISTANT_MANAGE)) {
      throw new Error('Access denied: requires assistant.manage')
    }
  },
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(connectorQueries.detail(params.connectorId))
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: ConnectorDetailPage,
})

function ToolGroup({
  title,
  tools,
  defaultPolicy,
  onDefault,
  onTool,
  chips,
}: {
  title: string
  tools: ConnectorToolDTO[]
  defaultPolicy?: ConnectorToolPolicy
  onDefault?: (next: ConnectorToolPolicy) => void
  onTool?: (name: string, next: ConnectorToolPolicy) => void
  chips?: boolean
}) {
  if (tools.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-[18px] py-2.5 text-[12.5px] font-semibold">
        {title}
        <span className="rounded-md bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
          {tools.length}
        </span>
        <span className="ms-auto">
          {chips ? (
            <Badge
              size="sm"
              className={
                defaultPolicy === 'always'
                  ? 'border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-transparent bg-amber-500/10 text-amber-800 dark:text-amber-300'
              }
            >
              {defaultPolicy === 'always'
                ? 'Always run'
                : 'Automatic on Agent · Approval on Copilot'}
            </Badge>
          ) : (
            defaultPolicy &&
            onDefault && <PolicyDefaultSelect value={defaultPolicy} onChange={onDefault} />
          )}
        </span>
      </div>
      {tools.map((tool) => (
        <div
          key={tool.name}
          className="flex items-center gap-2.5 border-b border-border/60 py-2.5 pe-[18px] ps-[30px] last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
              {chips ? tool.title || tool.name : tool.name}
              {tool.destructive && (
                <Badge
                  size="sm"
                  className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400"
                >
                  destructive
                </Badge>
              )}
              {tool.isNew && <Badge size="sm">new</Badge>}
            </div>
            {tool.description && (
              <p className="truncate text-[11.5px] text-muted-foreground">{tool.description}</p>
            )}
          </div>
          {chips ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {tool.group === 'read' ? (
                <Badge
                  size="sm"
                  className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                >
                  Always runs
                </Badge>
              ) : (
                <>
                  <Badge size="sm">Agent: automatic</Badge>
                  <Badge
                    size="sm"
                    className="border-transparent bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  >
                    Copilot: approval
                  </Badge>
                </>
              )}
            </div>
          ) : (
            onTool && (
              <PolicyDial
                value={tool.policy}
                labelledBy={tool.name}
                onChange={(next) => onTool(tool.name, next)}
              />
            )
          )}
        </div>
      ))}
    </div>
  )
}

function ConnectorDetailPage() {
  const intl = useIntl()
  const { connectorId } = Route.useParams()
  const navigate = useNavigate()
  const detail = useQuery(connectorQueries.detail(connectorId))
  const update = useUpdateConnector()
  const refresh = useRefreshConnector()
  const remove = useDeleteConnector()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const builtin = detail.data?.builtin
  const connector = detail.data?.connector

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (builtin || connectorId === 'quackback') {
    return <Navigate to="/admin/automation/connectors" />
  }
  if (!connector) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <BackLink to="/admin/automation/connectors">
          {intl.formatMessage({ id: 'automation.connectors.title', defaultMessage: 'Connectors' })}
        </BackLink>
        <p className="text-sm text-muted-foreground">Connector not found.</p>
      </div>
    )
  }

  const reads = connector.tools.filter((tool) => tool.group === 'read')
  const writes = connector.tools.filter((tool) => tool.group === 'write')

  const savePolicies = (
    nextTools: Record<string, ConnectorToolPolicy>,
    group?: {
      read?: ConnectorToolPolicy
      write?: ConnectorToolPolicy
    }
  ) => {
    update.mutate(
      {
        id: connector.id,
        toolPolicies: {
          groupDefaults: {
            read: group?.read ?? connector.toolPolicies.groupDefaults.read,
            write: group?.write ?? connector.toolPolicies.groupDefaults.write,
          },
          tools: nextTools,
        },
      },
      { onError: () => toast.error('Could not save permissions') }
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <BackLink to="/admin/automation/connectors">
        {intl.formatMessage({ id: 'automation.connectors.title', defaultMessage: 'Connectors' })}
      </BackLink>
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <ConnectorMark name={connector.name} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[17px] font-semibold">{connector.name}</h1>
              <ConnectorStatusBadge status={connector.status} />
            </div>
            <p className="font-mono text-xs text-muted-foreground">{connector.url}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              refresh.mutate(connector.id, {
                onError: () => toast.error('Refresh failed'),
              })
            }
          >
            <ArrowPathIcon className="size-4" />
            Refresh tools
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
            Disconnect
          </Button>
        </div>
      </div>

      <SettingsCard
        title="Available to"
        description="Which Quinn agents can use this connector's tools."
      >
        <div className="space-y-3">
          {(['agent', 'copilot'] as const).map((agent) => (
            <div
              key={agent}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
            >
              <div>
                <div id={`connector-available-${agent}`} className="text-[13px] font-medium">
                  {agent === 'agent' ? 'Agent' : 'Copilot'}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {agent === 'agent'
                    ? 'Customer-facing. Approvals land as inbox cards for your team.'
                    : 'Teammate-facing. Approvals appear inline in the Copilot panel.'}
                </p>
              </div>
              <Switch
                aria-labelledby={`connector-available-${agent}`}
                checked={connector.assignments[agent]}
                onCheckedChange={(checked) =>
                  update.mutate(
                    {
                      id: connector.id,
                      assignments: { ...connector.assignments, [agent]: checked },
                    },
                    {
                      onError: () => {
                        toast.error('Could not update availability')
                      },
                    }
                  )
                }
              />
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Tool permissions"
        description="Choose when Quinn is allowed to use each tool."
        contentClassName="p-0"
      >
        <ToolGroup
          title="Read-only tools"
          tools={reads}
          defaultPolicy={connector.toolPolicies.groupDefaults.read}
          onDefault={(next) => savePolicies(connector.toolPolicies.tools, { read: next })}
          onTool={(name, next) => savePolicies({ ...connector.toolPolicies.tools, [name]: next })}
        />
        <ToolGroup
          title="Write tools"
          tools={writes}
          defaultPolicy={connector.toolPolicies.groupDefaults.write}
          onDefault={(next) => savePolicies(connector.toolPolicies.tools, { write: next })}
          onTool={(name, next) => savePolicies({ ...connector.toolPolicies.tools, [name]: next })}
        />
      </SettingsCard>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Disconnect this connector?"
        description="Quinn will stop calling its tools. Existing approval cards fail closed."
        confirmLabel="Disconnect"
        onConfirm={() => {
          remove.mutate(connector.id, {
            onSuccess: () => {
              void navigate({ to: '/admin/automation/connectors' })
            },
            onError: () => toast.error('Could not disconnect'),
          })
        }}
      />
    </div>
  )
}
