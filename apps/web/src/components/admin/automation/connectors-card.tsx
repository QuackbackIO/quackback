'use client'

/**
 * Quinn Connectors — outbound MCP servers with per-tool Ask / Always allow / Deny.
 *
 * Each connector is an MCP server connection. After sync, every discovered tool
 * appears under that connector so the operator can set permissions the same way
 * agent products brand as "Connectors".
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl, FormattedMessage } from 'react-intl'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { assistantQueries, assistantKeys } from '@/lib/client/queries/assistant'
import {
  createConnectorFn,
  deleteConnectorFn,
  syncConnectorFn,
  updateConnectorFn,
  updateConnectorToolRuleFn,
} from '@/lib/server/functions/assistant-connectors'
import type { AssistantAgentKind, AssistantToolRule } from '@/lib/shared/assistant/config'
import type { ConnectorPublicDTO } from '@/lib/server/domains/assistant/connectors.service'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '@heroicons/react/24/outline'

const RULE_OPTIONS: Array<{ value: AssistantToolRule; labelId: string; defaultMessage: string }> = [
  {
    value: 'ask',
    labelId: 'automation.connectors.rule.ask',
    defaultMessage: 'Ask for approval',
  },
  {
    value: 'allow',
    labelId: 'automation.connectors.rule.allow',
    defaultMessage: 'Always allow',
  },
  {
    value: 'deny',
    labelId: 'automation.connectors.rule.deny',
    defaultMessage: 'Deny',
  },
]

export function ConnectorsCard({ agent }: { agent: AssistantAgentKind }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const connectorsQuery = useQuery(assistantQueries.connectors())
  const [createOpen, setCreateOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.connectors() })
  }

  const createMutation = useMutation({
    mutationFn: createConnectorFn,
    onSuccess: () => {
      invalidate()
      setCreateOpen(false)
      toast.success(
        intl.formatMessage({
          id: 'automation.connectors.created',
          defaultMessage: 'Connector added. Tools synced when the server responded.',
        })
      )
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not add connector')
    },
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) => syncConnectorFn({ data: { id } }),
    onSuccess: () => {
      invalidate()
      toast.success(
        intl.formatMessage({
          id: 'automation.connectors.synced',
          defaultMessage: 'Connector tools refreshed.',
        })
      )
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not sync connector')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConnectorFn({ data: { id } }),
    onSuccess: () => {
      invalidate()
      toast.success(
        intl.formatMessage({
          id: 'automation.connectors.deleted',
          defaultMessage: 'Connector removed.',
        })
      )
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not delete connector')
    },
  })

  const ruleMutation = useMutation({
    mutationFn: (input: { id: string; toolName: string; rule: AssistantToolRule }) =>
      updateConnectorToolRuleFn({ data: input }),
    onSuccess: () => invalidate(),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not update tool permission')
    },
  })

  const assignmentMutation = useMutation({
    mutationFn: (input: { id: string; assignments: { agent: boolean; copilot: boolean } }) =>
      updateConnectorFn({ data: input }),
    onSuccess: () => invalidate(),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not update assignment')
    },
  })

  const title = intl.formatMessage({
    id: 'automation.connectors.title',
    defaultMessage: 'Connectors',
  })
  const description = intl.formatMessage({
    id: 'automation.connectors.description',
    defaultMessage:
      'Connect MCP servers so Quinn can use their tools. Set Ask for approval, Always allow, or Deny on each tool.',
  })

  const connectors = (connectorsQuery.data ?? []).filter((connector) =>
    agent === 'agent' ? connector.assignments.agent : connector.assignments.copilot
  )

  return (
    <>
      <SettingsCard
        title={title}
        description={description}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-3.5" />
            <FormattedMessage id="automation.connectors.add" defaultMessage="Add connector" />
          </Button>
        }
      >
        {connectorsQuery.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            <FormattedMessage
              id="automation.connectors.loading"
              defaultMessage="Loading connectors…"
            />
          </p>
        ) : connectorsQuery.isError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              <FormattedMessage
                id="automation.connectors.loadError"
                defaultMessage="Connectors could not be loaded."
              />
            </p>
            <Button variant="outline" size="sm" onClick={() => void connectorsQuery.refetch()}>
              <FormattedMessage id="automation.agent.retry" defaultMessage="Try again" />
            </Button>
          </div>
        ) : connectors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="automation.connectors.empty"
              defaultMessage="No connectors yet. Add an MCP server to catalogue its tools here."
            />
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {connectors.map((connector) => (
              <ConnectorRow
                key={connector.id}
                connector={connector}
                agent={agent}
                expanded={expanded[connector.id] === true}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [connector.id]: !prev[connector.id] }))
                }
                onSync={() => syncMutation.mutate(connector.id)}
                syncing={syncMutation.isPending && syncMutation.variables === connector.id}
                onDelete={() => {
                  if (
                    window.confirm(
                      intl.formatMessage({
                        id: 'automation.connectors.deleteConfirm',
                        defaultMessage: 'Remove this connector and its tool permissions?',
                      })
                    )
                  ) {
                    deleteMutation.mutate(connector.id)
                  }
                }}
                onRuleChange={(toolName, rule) =>
                  ruleMutation.mutate({ id: connector.id, toolName, rule })
                }
                onAssignmentChange={(checked) => {
                  const assignments =
                    agent === 'agent'
                      ? { agent: checked, copilot: connector.assignments.copilot }
                      : { agent: connector.assignments.agent, copilot: checked }
                  assignmentMutation.mutate({ id: connector.id, assignments })
                }}
              />
            ))}
          </div>
        )}
      </SettingsCard>

      <CreateConnectorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={createMutation.isPending}
        onSubmit={(values) => createMutation.mutate({ data: values })}
      />
    </>
  )
}

function ConnectorRow({
  connector,
  agent,
  expanded,
  onToggle,
  onSync,
  syncing,
  onDelete,
  onRuleChange,
  onAssignmentChange,
}: {
  connector: ConnectorPublicDTO
  agent: AssistantAgentKind
  expanded: boolean
  onToggle: () => void
  onSync: () => void
  syncing: boolean
  onDelete: () => void
  onRuleChange: (toolName: string, rule: AssistantToolRule) => void
  onAssignmentChange: (checked: boolean) => void
}) {
  const intl = useIntl()
  const assigned = agent === 'agent' ? connector.assignments.agent : connector.assignments.copilot

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-0.5 text-muted-foreground"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDownIcon className="size-4" />
          ) : (
            <ChevronRightIcon className="size-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{connector.name}</h3>
            <Badge size="sm" variant="secondary" shape="pill">
              <FormattedMessage
                id="automation.connectors.toolCount"
                defaultMessage="{count, plural, =0 {No tools} one {# tool} other {# tools}}"
                values={{ count: connector.tools.length }}
              />
            </Badge>
            {!connector.enabled && (
              <Badge size="sm" variant="outline" shape="pill">
                <FormattedMessage id="automation.connectors.disabled" defaultMessage="Disabled" />
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{connector.url}</p>
          {connector.lastSyncError && (
            <p className="mt-1 text-xs text-destructive">{connector.lastSyncError}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Switch
              id={`connector-assign-${connector.id}`}
              checked={assigned}
              onCheckedChange={onAssignmentChange}
            />
            <Label htmlFor={`connector-assign-${connector.id}`} className="text-xs">
              <FormattedMessage id="automation.connectors.assigned" defaultMessage="Assigned" />
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={onSync} disabled={syncing}>
            <FormattedMessage id="automation.connectors.sync" defaultMessage="Refresh tools" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <FormattedMessage id="automation.connectors.delete" defaultMessage="Remove" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ms-7 divide-y divide-border/40 rounded-md border border-border/60">
          {connector.tools.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              <FormattedMessage
                id="automation.connectors.noTools"
                defaultMessage="No tools yet. Refresh to pull the catalogue from this MCP server."
              />
            </p>
          ) : (
            connector.tools.map((tool) => {
              const rule = (connector.toolRules[tool.name] ?? 'ask') as AssistantToolRule
              return (
                <div
                  key={tool.name}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{tool.name}</p>
                    {tool.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {tool.description}
                      </p>
                    ) : null}
                  </div>
                  <Select
                    value={rule}
                    onValueChange={(value) => onRuleChange(tool.name, value as AssistantToolRule)}
                  >
                    <SelectTrigger size="sm" className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {intl.formatMessage({
                            id: option.labelId,
                            defaultMessage: option.defaultMessage,
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function CreateConnectorDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (values: {
    name: string
    url: string
    authToken?: string | null
    assignments: { agent: boolean; copilot: boolean }
    enabled: boolean
  }) => void
}) {
  const intl = useIntl()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authToken, setAuthToken] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage id="automation.connectors.addTitle" defaultMessage="Add connector" />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="connector-name">
              <FormattedMessage id="automation.connectors.name" defaultMessage="Name" />
            </Label>
            <Input
              id="connector-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={intl.formatMessage({
                id: 'automation.connectors.namePlaceholder',
                defaultMessage: 'Linear',
              })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="connector-url">
              <FormattedMessage id="automation.connectors.url" defaultMessage="MCP server URL" />
            </Label>
            <Input
              id="connector-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="connector-token">
              <FormattedMessage
                id="automation.connectors.token"
                defaultMessage="Auth token (optional)"
              />
            </Label>
            <Input
              id="connector-token"
              type="password"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            disabled={pending || name.trim().length < 1 || url.trim().length < 1}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                url: url.trim(),
                authToken: authToken.trim() ? authToken.trim() : null,
                assignments: { agent: true, copilot: true },
                enabled: true,
              })
            }
          >
            <FormattedMessage
              id="automation.connectors.addConfirm"
              defaultMessage="Add connector"
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
