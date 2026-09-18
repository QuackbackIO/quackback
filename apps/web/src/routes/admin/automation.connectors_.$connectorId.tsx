import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { ConnectorMark } from '@/components/admin/automation/connectors/connector-mark'
import { ConnectorStatusBadge } from '@/components/admin/automation/connectors/connector-status-badge'
import { ConnectorToolPolicies } from '@/components/admin/automation/connectors/connector-tool-policies'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
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
      <div className="max-w-3xl space-y-4">
        <BackLink to="/admin/automation/connectors">
          {intl.formatMessage({ id: 'automation.connectors.title', defaultMessage: 'Connectors' })}
        </BackLink>
        <p className="text-sm text-muted-foreground">Connector not found.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
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
                  {agent === 'agent' ? 'Customer conversations' : 'Support teammates'}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {agent === 'agent'
                    ? 'Customer-facing. Approvals land as inbox cards for your team.'
                    : 'Teammate-facing. Approvals appear inline in the Quinn panel.'}
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

      <ConnectorToolPolicies connector={connector} />

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
