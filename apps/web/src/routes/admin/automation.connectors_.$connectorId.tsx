import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
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

function PolicyDial({
  value,
  onChange,
}: {
  value: ConnectorToolPolicy
  onChange: (next: ConnectorToolPolicy) => void
}) {
  const options: Array<{ id: ConnectorToolPolicy; label: string }> = [
    { id: 'always', label: 'Always allow' },
    { id: 'approval', label: 'Needs approval' },
    { id: 'never', label: 'Never' },
  ]
  return (
    <div role="radiogroup" className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-label={option.label}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={
            value === option.id
              ? 'rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground'
              : 'rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted'
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

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
      <div className="flex items-center justify-between border-b border-border/60 px-1 py-2">
        <span className="text-[13px] font-medium">
          {title} <span className="text-muted-foreground">{tools.length}</span>
        </span>
        {chips ? (
          <Badge size="sm">
            {defaultPolicy === 'always' ? 'Always run' : 'Approval on Copilot'}
          </Badge>
        ) : (
          defaultPolicy && onDefault && <PolicyDial value={defaultPolicy} onChange={onDefault} />
        )}
      </div>
      {tools.map((tool) => (
        <div key={tool.name} className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              {tool.title || tool.name}
              {tool.destructive && (
                <Badge size="sm" className="bg-destructive/10 text-destructive">
                  destructive
                </Badge>
              )}
              {tool.isNew && <Badge size="sm">new</Badge>}
            </div>
            {tool.description && (
              <p className="text-xs text-muted-foreground">{tool.description}</p>
            )}
          </div>
          {chips ? (
            <div className="flex flex-wrap justify-end gap-1">
              <Badge size="sm">{tool.group === 'read' ? 'Always runs' : 'Agent: automatic'}</Badge>
              {tool.group === 'write' && <Badge size="sm">Copilot: approval</Badge>}
            </div>
          ) : (
            onTool && (
              <PolicyDial value={tool.policy} onChange={(next) => onTool(tool.name, next)} />
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
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>
  }
  if (!builtin && !connector) {
    return <p className="p-6 text-sm text-muted-foreground">Connector not found.</p>
  }

  if (builtin) {
    const reads = builtin.tools.filter((tool) => tool.group === 'read')
    const writes = builtin.tools.filter((tool) => tool.group === 'write')
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <BackLink to="/admin/automation/connectors">
          {intl.formatMessage({ id: 'automation.connectors.title', defaultMessage: 'Connectors' })}
        </BackLink>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-amber-400 text-sm font-semibold text-amber-950">
            Q
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Quackback</h1>
              <Badge size="sm">Built-in</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Quinn's built-in actions. Audited on every call; behavior is managed by Quinn and not
              individually configurable.
            </p>
          </div>
        </div>
        <SettingsCard>
          <ToolGroup
            title="Read-only tools"
            tools={reads.map((tool) => ({
              name: tool.name,
              title: tool.label,
              description: tool.description,
              group: tool.group,
              destructive: false,
              policy: 'always',
              isOverride: false,
              isNew: false,
            }))}
            chips
            defaultPolicy="always"
          />
          <ToolGroup
            title="Write tools"
            tools={writes.map((tool) => ({
              name: tool.name,
              title: tool.label,
              description: tool.description,
              group: tool.group,
              destructive: false,
              policy: 'approval',
              isOverride: false,
              isNew: false,
            }))}
            chips
            defaultPolicy="approval"
          />
        </SettingsCard>
      </div>
    )
  }

  if (!connector) return null

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
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <BackLink to="/admin/automation/connectors">
        {intl.formatMessage({ id: 'automation.connectors.title', defaultMessage: 'Connectors' })}
      </BackLink>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{connector.name}</h1>
            <Badge size="sm">
              {connector.status === 'error' ? 'Needs attention' : 'Connected'}
            </Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{connector.url}</p>
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
                <div className="text-[13px] font-medium">
                  {agent === 'agent' ? 'Agent' : 'Copilot'}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {agent === 'agent'
                    ? 'Customer-facing. Approvals land as inbox cards for your team.'
                    : 'Teammate-facing. Approvals appear inline in the Copilot panel.'}
                </p>
              </div>
              <Switch
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
