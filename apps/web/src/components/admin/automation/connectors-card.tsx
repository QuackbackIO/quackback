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
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
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

function connectorUrlLooksValid(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function matchesToolQuery(tool: { name: string; description: string }, query: string): boolean {
  if (query.length === 0) return true
  const haystack = `${tool.name} ${tool.description}`.toLowerCase()
  return haystack.includes(query)
}

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
  const [editTarget, setEditTarget] = useState<ConnectorPublicDTO | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConnectorPublicDTO | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [connectorQuery, setConnectorQuery] = useState('')

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.connectors() })
  }

  const createMutation = useMutation({
    mutationFn: createConnectorFn,
    onSuccess: (connector) => {
      invalidate()
      setCreateOpen(false)
      if (connector.lastSyncError) {
        toast.warning(
          intl.formatMessage({
            id: 'automation.connectors.createdUnsynced',
            defaultMessage:
              'Connector added, but tools could not be synced. Check the URL and refresh.',
          })
        )
        return
      }
      toast.success(
        intl.formatMessage(
          {
            id: 'automation.connectors.createdSynced',
            defaultMessage:
              '{count, plural, =0 {Connector added. No tools returned yet.} one {Connector added. 1 tool synced.} other {Connector added. # tools synced.}}',
          },
          { count: connector.tools.length }
        )
      )
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          intl.formatMessage({
            id: 'automation.connectors.createError',
            defaultMessage: 'Could not add connector',
          })
        )
      )
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
      toast.error(
        mutationErrorMessage(
          error,
          intl.formatMessage({
            id: 'automation.connectors.syncError',
            defaultMessage: 'Could not refresh connector tools',
          })
        )
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConnectorFn({ data: { id } }),
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
      toast.success(
        intl.formatMessage({
          id: 'automation.connectors.deleted',
          defaultMessage: 'Connector removed.',
        })
      )
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          intl.formatMessage({
            id: 'automation.connectors.deleteError',
            defaultMessage: 'Could not remove connector',
          })
        )
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateConnectorFn,
    onSuccess: () => {
      invalidate()
      setEditTarget(null)
      toast.success(
        intl.formatMessage({
          id: 'automation.connectors.updated',
          defaultMessage: 'Connector updated.',
        })
      )
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          intl.formatMessage({
            id: 'automation.connectors.updateError',
            defaultMessage: 'Could not update connector',
          })
        )
      )
    },
  })

  const ruleMutation = useMutation({
    mutationFn: (input: { id: string; toolName: string; rule: AssistantToolRule | null }) =>
      updateConnectorToolRuleFn({ data: input }),
    onSuccess: () => invalidate(),
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          intl.formatMessage({
            id: 'automation.connectors.ruleError',
            defaultMessage: 'Could not update tool permission',
          })
        )
      )
    },
  })

  const assignmentMutation = useMutation({
    mutationFn: (input: { id: string; assignments: { agent: boolean; copilot: boolean } }) =>
      updateConnectorFn({ data: input }),
    onSuccess: () => invalidate(),
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          intl.formatMessage({
            id: 'automation.connectors.assignmentError',
            defaultMessage: 'Could not update assignment',
          })
        )
      )
    },
  })

  const title = intl.formatMessage({
    id: 'automation.connectors.title',
    defaultMessage: 'Connectors',
  })
  const description = intl.formatMessage({
    id:
      agent === 'agent'
        ? 'automation.connectors.description.agent'
        : 'automation.connectors.description.copilot',
    defaultMessage:
      agent === 'agent'
        ? 'Connect an MCP server so Quinn can use its tools on customer conversations. Ask queues a teammate approval. Tool permissions apply to both agents.'
        : 'Connect an MCP server so Quinn can use its tools from Copilot. Ask queues a teammate approval. Tool permissions apply to both agents.',
  })

  const connectors = connectorsQuery.data ?? []
  const connectorFilter = connectorQuery.trim().toLowerCase()
  const visibleConnectors =
    connectorFilter.length === 0
      ? connectors
      : connectors.filter((connector) => {
          const haystack = `${connector.name} ${connector.url} ${connector.tools
            .map((tool) => `${tool.name} ${tool.description}`)
            .join(' ')}`.toLowerCase()
          return haystack.includes(connectorFilter)
        })

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
              defaultMessage="No connectors yet. Paste the MCP endpoint from the service’s developer settings to catalogue its tools here."
            />
          </p>
        ) : (
          <div className="space-y-3">
            {connectors.length > 3 && (
              <Input
                value={connectorQuery}
                onChange={(event) => setConnectorQuery(event.target.value)}
                placeholder={intl.formatMessage({
                  id: 'automation.connectors.filter',
                  defaultMessage: 'Filter connectors',
                })}
                aria-label={intl.formatMessage({
                  id: 'automation.connectors.filter',
                  defaultMessage: 'Filter connectors',
                })}
              />
            )}
            {visibleConnectors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <FormattedMessage
                  id="automation.connectors.filterEmpty"
                  defaultMessage="No connectors match that filter."
                />
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {visibleConnectors.map((connector) => (
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
                    onEdit={() => setEditTarget(connector)}
                    onDelete={() => setDeleteTarget(connector)}
                    onRuleChange={(toolName, rule) =>
                      ruleMutation.mutate({ id: connector.id, toolName, rule })
                    }
                    rulePendingKey={
                      ruleMutation.isPending && ruleMutation.variables
                        ? `${ruleMutation.variables.id}:${ruleMutation.variables.toolName}`
                        : null
                    }
                    onAssignmentChange={(checked) => {
                      const assignments =
                        agent === 'agent'
                          ? { agent: checked, copilot: connector.assignments.copilot }
                          : { agent: connector.assignments.agent, copilot: checked }
                      assignmentMutation.mutate({ id: connector.id, assignments })
                    }}
                    onEnabledChange={(enabled) =>
                      updateMutation.mutate({ data: { id: connector.id, enabled } })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </SettingsCard>

      <CreateConnectorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={createMutation.isPending}
        onSubmit={(values) => createMutation.mutate({ data: values })}
      />

      {editTarget && (
        <EditConnectorDialog
          connector={editTarget}
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null)
          }}
          pending={updateMutation.isPending}
          onSubmit={(values) => updateMutation.mutate({ data: { id: editTarget.id, ...values } })}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={intl.formatMessage({
          id: 'automation.connectors.deleteTitle',
          defaultMessage: 'Remove this connector?',
        })}
        description={intl.formatMessage({
          id: 'automation.connectors.deleteDescription',
          defaultMessage:
            'This removes the connection and its tool permissions for both Agent and Copilot.',
        })}
        confirmLabel={intl.formatMessage({
          id: 'automation.connectors.delete',
          defaultMessage: 'Remove',
        })}
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
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
  onEdit,
  onDelete,
  onRuleChange,
  rulePendingKey,
  onAssignmentChange,
  onEnabledChange,
}: {
  connector: ConnectorPublicDTO
  agent: AssistantAgentKind
  expanded: boolean
  onToggle: () => void
  onSync: () => void
  syncing: boolean
  onEdit: () => void
  onDelete: () => void
  onRuleChange: (toolName: string, rule: AssistantToolRule | null) => void
  rulePendingKey: string | null
  onAssignmentChange: (checked: boolean) => void
  onEnabledChange: (enabled: boolean) => void
}) {
  const intl = useIntl()
  const [toolQuery, setToolQuery] = useState('')
  const assigned = agent === 'agent' ? connector.assignments.agent : connector.assignments.copilot
  const askCount = connector.tools.filter(
    (tool) => (connector.toolRules[tool.name] ?? 'ask') === 'ask'
  ).length
  const allowCount = connector.tools.filter(
    (tool) => connector.toolRules[tool.name] === 'allow'
  ).length
  const denyCount = connector.tools.filter(
    (tool) => connector.toolRules[tool.name] === 'deny'
  ).length

  return (
    <div className={`py-4 first:pt-0 last:pb-0 ${assigned ? '' : 'opacity-70'}`}>
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mt-0.5 text-muted-foreground"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={intl.formatMessage(
            {
              id: 'automation.connectors.toggleTools',
              defaultMessage: '{expanded, select, true {Collapse} other {Expand}} tools for {name}',
            },
            { expanded, name: connector.name }
          )}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </Button>
        <button
          type="button"
          className="min-w-0 flex-1 rounded-sm text-start"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{connector.name}</h3>
            <Badge size="sm" variant="secondary" shape="pill">
              <FormattedMessage
                id="automation.connectors.toolCount"
                defaultMessage="{count, plural, =0 {No tools} one {# tool} other {# tools}}"
                values={{ count: connector.tools.length }}
              />
            </Badge>
            {!assigned && (
              <Badge size="sm" variant="outline" shape="pill">
                <FormattedMessage
                  id="automation.connectors.notAssigned"
                  defaultMessage="Not assigned to this agent"
                />
              </Badge>
            )}
            {!connector.enabled && (
              <Badge size="sm" variant="outline" shape="pill">
                <FormattedMessage id="automation.connectors.disabled" defaultMessage="Disabled" />
              </Badge>
            )}
            {connector.hasAuthToken && (
              <Badge size="sm" variant="secondary" shape="pill">
                <FormattedMessage id="automation.connectors.hasToken" defaultMessage="Token set" />
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{connector.url}</p>
          {connector.tools.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              <FormattedMessage
                id="automation.connectors.ruleSummary"
                defaultMessage="{ask} ask · {allow} allow · {deny} deny — applies to both agents"
                values={{ ask: askCount, allow: allowCount, deny: denyCount }}
              />
            </p>
          )}
          {connector.lastSyncError && (
            <p className="mt-1 text-xs text-destructive">{connector.lastSyncError}</p>
          )}
        </button>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1.5">
            <Switch
              id={`connector-assign-${connector.id}`}
              checked={assigned}
              onCheckedChange={onAssignmentChange}
            />
            <Label htmlFor={`connector-assign-${connector.id}`} className="text-xs">
              <FormattedMessage
                id="automation.connectors.assigned"
                defaultMessage="Enabled for this agent"
              />
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id={`connector-enabled-${connector.id}`}
              checked={connector.enabled}
              onCheckedChange={onEnabledChange}
            />
            <Label htmlFor={`connector-enabled-${connector.id}`} className="text-xs">
              <FormattedMessage id="automation.connectors.enabled" defaultMessage="On" />
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={onSync} disabled={syncing}>
            {syncing ? (
              <FormattedMessage id="automation.connectors.syncing" defaultMessage="Refreshing…" />
            ) : (
              <FormattedMessage id="automation.connectors.sync" defaultMessage="Refresh tools" />
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <FormattedMessage id="automation.connectors.edit" defaultMessage="Edit" />
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
            <>
              {connector.tools.length > 5 && (
                <div className="px-3 pt-3">
                  <Input
                    value={toolQuery}
                    onChange={(event) => setToolQuery(event.target.value)}
                    placeholder={intl.formatMessage({
                      id: 'automation.connectors.filterTools',
                      defaultMessage: 'Filter tools',
                    })}
                    aria-label={intl.formatMessage({
                      id: 'automation.connectors.filterTools',
                      defaultMessage: 'Filter tools',
                    })}
                  />
                </div>
              )}
              {connector.tools.filter((tool) =>
                matchesToolQuery(tool, toolQuery.trim().toLowerCase())
              ).length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  <FormattedMessage
                    id="automation.connectors.filterToolsEmpty"
                    defaultMessage="No tools match that filter."
                  />
                </p>
              ) : (
                connector.tools
                  .filter((tool) => matchesToolQuery(tool, toolQuery.trim().toLowerCase()))
                  .map((tool) => {
                    const saved = connector.toolRules[tool.name]
                    const rule = (saved ?? 'ask') as AssistantToolRule
                    const pending = rulePendingKey === `${connector.id}:${tool.name}`
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
                        <div className="flex items-center gap-2">
                          {saved ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => onRuleChange(tool.name, null)}
                            >
                              <FormattedMessage
                                id="automation.connectors.resetRule"
                                defaultMessage="Reset"
                              />
                            </Button>
                          ) : null}
                          <Select
                            value={rule}
                            disabled={pending}
                            onValueChange={(value) =>
                              onRuleChange(tool.name, value as AssistantToolRule)
                            }
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
                      </div>
                    )
                  })
              )}
            </>
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
  const [assignAgent, setAssignAgent] = useState(true)
  const [assignCopilot, setAssignCopilot] = useState(true)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('')
          setUrl('')
          setAuthToken('')
          setAssignAgent(true)
          setAssignCopilot(true)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage id="automation.connectors.addTitle" defaultMessage="Add connector" />
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="automation.connectors.addHint"
            defaultMessage="Paste the MCP endpoint from the service’s developer settings. Use https. An auth token is optional."
          />
        </p>
        <ConnectorFields
          name={name}
          url={url}
          authToken={authToken}
          onNameChange={setName}
          onUrlChange={setUrl}
          onAuthTokenChange={setAuthToken}
          namePlaceholder={intl.formatMessage({
            id: 'automation.connectors.namePlaceholder',
            defaultMessage: 'Project tracker',
          })}
        />
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-1.5">
            <Switch
              id="connector-create-agent"
              checked={assignAgent}
              onCheckedChange={setAssignAgent}
            />
            <Label htmlFor="connector-create-agent" className="text-xs">
              <FormattedMessage
                id="automation.connectors.assignAgent"
                defaultMessage="Enable for Agent"
              />
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="connector-create-copilot"
              checked={assignCopilot}
              onCheckedChange={setAssignCopilot}
            />
            <Label htmlFor="connector-create-copilot" className="text-xs">
              <FormattedMessage
                id="automation.connectors.assignCopilot"
                defaultMessage="Enable for Copilot"
              />
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            disabled={pending || name.trim().length < 1 || !connectorUrlLooksValid(url)}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                url: url.trim(),
                authToken: authToken.trim() ? authToken.trim() : null,
                assignments: { agent: assignAgent, copilot: assignCopilot },
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

function EditConnectorDialog({
  connector,
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  connector: ConnectorPublicDTO
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (values: { name: string; url: string; authToken?: string | null }) => void
}) {
  const intl = useIntl()
  const [name, setName] = useState(connector.name)
  const [url, setUrl] = useState(connector.url)
  const [authToken, setAuthToken] = useState('')
  const urlChanged = url.trim() !== connector.url
  const tokenHint = urlChanged
    ? intl.formatMessage({
        id: 'automation.connectors.tokenClearedOnUrlChange',
        defaultMessage: 'Changing the URL clears the saved token unless you enter a new one.',
      })
    : connector.hasAuthToken
      ? intl.formatMessage({
          id: 'automation.connectors.tokenReplace',
          defaultMessage: 'Leave blank to keep the current token.',
        })
      : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage
              id="automation.connectors.editTitle"
              defaultMessage="Edit connector"
            />
          </DialogTitle>
        </DialogHeader>
        <ConnectorFields
          name={name}
          url={url}
          authToken={authToken}
          onNameChange={setName}
          onUrlChange={setUrl}
          onAuthTokenChange={setAuthToken}
          tokenHint={tokenHint}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            disabled={pending || name.trim().length < 1 || !connectorUrlLooksValid(url)}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                url: url.trim(),
                authToken: authToken.trim() ? authToken.trim() : undefined,
              })
            }
          >
            <FormattedMessage id="automation.connectors.save" defaultMessage="Save" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConnectorFields({
  name,
  url,
  authToken,
  onNameChange,
  onUrlChange,
  onAuthTokenChange,
  namePlaceholder,
  tokenHint,
}: {
  name: string
  url: string
  authToken: string
  onNameChange: (value: string) => void
  onUrlChange: (value: string) => void
  onAuthTokenChange: (value: string) => void
  namePlaceholder?: string
  tokenHint?: string
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="connector-name">
          <FormattedMessage id="automation.connectors.name" defaultMessage="Name" />
        </Label>
        <Input
          id="connector-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={namePlaceholder}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="connector-url">
          <FormattedMessage id="automation.connectors.url" defaultMessage="MCP server URL" />
        </Label>
        <Input
          id="connector-url"
          type="url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          aria-invalid={url.trim().length > 0 && !connectorUrlLooksValid(url)}
        />
        {url.trim().length > 0 && !connectorUrlLooksValid(url) ? (
          <p className="text-xs text-destructive">
            <FormattedMessage
              id="automation.connectors.urlInvalid"
              defaultMessage="Enter an http(s) URL, for example https://mcp.example.com/mcp"
            />
          </p>
        ) : null}
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
          onChange={(event) => onAuthTokenChange(event.target.value)}
          autoComplete="off"
        />
        {tokenHint ? <p className="text-xs text-muted-foreground">{tokenHint}</p> : null}
      </div>
    </div>
  )
}
