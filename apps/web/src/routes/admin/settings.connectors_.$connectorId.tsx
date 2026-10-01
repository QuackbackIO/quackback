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
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { connectorQueries } from '@/lib/client/queries/assistant-connectors'
import {
  useDeleteConnector,
  useRefreshConnector,
  useUpdateConnector,
} from '@/lib/client/mutations/assistant-connectors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import type { ConnectorToolDTO, ConnectorToolPolicy } from '@/lib/shared/assistant/connectors'
import { useState } from 'react'

// Trailing underscore on "connectors_" escapes nesting under the list route,
// which has no Outlet. URL stays /admin/settings/connectors/:connectorId.
export const Route = createFileRoute('/admin/settings/connectors_/$connectorId')({
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.ASSISTANT_MANAGE)
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
}: {
  title: string
  tools: ConnectorToolDTO[]
  defaultPolicy?: ConnectorToolPolicy
  onDefault?: (next: ConnectorToolPolicy) => void
  onTool?: (name: string, next: ConnectorToolPolicy) => void
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
          {defaultPolicy && onDefault && (
            <PolicyDefaultSelect value={defaultPolicy} onChange={onDefault} />
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
              {tool.name}
              {tool.destructive && (
                <Badge size="sm" variant="destructive">
                  Destructive
                </Badge>
              )}
              {tool.isNew && <Badge size="sm">New</Badge>}
            </div>
            {tool.description && (
              <p className="truncate text-[11.5px] text-muted-foreground">{tool.description}</p>
            )}
          </div>
          {onTool && (
            <PolicyDial
              value={tool.policy}
              labelledBy={tool.name}
              onChange={(next) => onTool(tool.name, next)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function ConnectorDetailPage() {
  const intl = useIntl()
  const connectorCrumbs = [
    {
      label: intl.formatMessage({
        id: 'automation.connectors.title',
        defaultMessage: 'Connectors',
      }),
      to: '/admin/settings/connectors',
    },
  ]
  const { connectorId } = Route.useParams()
  const navigate = useNavigate()
  const detail = useQuery(connectorQueries.detail(connectorId))
  const update = useUpdateConnector({ autosave: true })
  const refresh = useRefreshConnector()
  const remove = useDeleteConnector()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const builtin = detail.data?.builtin
  const connector = detail.data?.connector

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (builtin || connectorId === 'quackback') {
    return <Navigate to="/admin/settings/connectors" />
  }
  if (!connector) {
    return (
      <SettingsPage title="Connector not found" crumbs={connectorCrumbs}>
        <p className="text-sm text-muted-foreground">
          This connector does not exist or was disconnected.
        </p>
      </SettingsPage>
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
    update.mutate({
      id: connector.id,
      toolPolicies: {
        groupDefaults: {
          read: group?.read ?? connector.toolPolicies.groupDefaults.read,
          write: group?.write ?? connector.toolPolicies.groupDefaults.write,
        },
        tools: nextTools,
      },
    })
  }

  return (
    <SettingsPage
      title={connector.name}
      crumbs={connectorCrumbs}
      logo={<ConnectorMark name={connector.name} size="lg" />}
      badge={<ConnectorStatusBadge status={connector.status} />}
      description={connector.url}
      actions={
        <>
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
        </>
      }
    >
      <SettingsCard title="Available to">
        <SettingRows>
          {(['agent', 'copilot'] as const).map((agent) => (
            <SettingRow
              key={agent}
              label={agent === 'agent' ? 'Agent' : 'Copilot'}
              htmlFor={`connector-available-${agent}`}
              description={
                agent === 'agent'
                  ? 'Customer-facing. Approvals land as inbox cards for your team.'
                  : 'Teammate-facing. Approvals appear inline in the Copilot panel.'
              }
              control={
                <Switch
                  id={`connector-available-${agent}`}
                  checked={connector.assignments[agent]}
                  onCheckedChange={(checked) =>
                    update.mutate({
                      id: connector.id,
                      assignments: { ...connector.assignments, [agent]: checked },
                    })
                  }
                />
              }
            />
          ))}
        </SettingRows>
      </SettingsCard>

      <SettingsCard title="Tool permissions" flush>
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
              void navigate({ to: '/admin/settings/connectors' })
            },
            onError: () => toast.error('Could not disconnect'),
          })
        }}
      />
    </SettingsPage>
  )
}
