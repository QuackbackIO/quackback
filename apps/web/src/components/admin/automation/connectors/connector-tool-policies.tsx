import { useState } from 'react'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useReviewConnectorTools,
  useUpdateConnector,
} from '@/lib/client/mutations/assistant-connectors'
import type {
  ConnectorDTO,
  ConnectorProfilePolicies,
  ConnectorToolDTO,
  ConnectorToolGroup,
  ConnectorToolPolicy,
} from '@/lib/shared/assistant/connectors'

/** The two uses this page edits. Workspace policy belongs to the linked surface's own settings. */
const USES = [
  ['agent', 'Customer conversations'],
  ['copilot', 'Support teammates'],
] as const

type Use = (typeof USES)[number][0]

const POLICY_LABELS: Record<ConnectorToolPolicy, string> = {
  always: 'Always allow',
  approval: 'Needs approval',
  never: 'Never',
}

const DEFAULT_VALUE = 'default'

function describeReview(tool: ConnectorToolDTO): string {
  if (tool.review.state === 'new') return 'new'
  return `${tool.review.changes.join(', ')} changed`
}

/**
 * Per-use permissions for one connector's tools.
 *
 * Two columns, one per use, because they are two independent decisions: the
 * page never shows a single answer that both would have to live with. A tool
 * whose contract is new or has changed shows what moved and stays unavailable
 * to both until somebody reviews it, and a tool whose input schema this
 * workspace cannot enforce says so instead of offering a control that could
 * never take effect.
 */
export function ConnectorToolPolicies({ connector }: { connector: ConnectorDTO }) {
  const update = useUpdateConnector()
  const review = useReviewConnectorTools()
  // The editor's own copy, kept until the server accepts it: a rejected write
  // (somebody else changed these permissions first) must not silently discard
  // what was being edited.
  const [draft, setDraft] = useState<ConnectorProfilePolicies | null>(null)
  const policies = draft ?? connector.profilePolicies

  const save = (next: ConnectorProfilePolicies) => {
    setDraft(next)
    update.mutate(
      {
        id: connector.id,
        profilePolicies: next,
        expectedPolicyVersion: connector.policyVersion,
      },
      {
        onSuccess: () => setDraft(null),
        onError: () =>
          toast.error('These permissions changed elsewhere. Reload to see the current settings.'),
      }
    )
  }

  const setGroupDefault = (use: Use, group: ConnectorToolGroup, policy: ConnectorToolPolicy) => {
    const record = policies[use]
    if (!record) return
    save({
      ...policies,
      [use]: { ...record, groupDefaults: { ...record.groupDefaults, [group]: policy } },
    })
  }

  const setToolPolicy = (use: Use, toolName: string, policy: ConnectorToolPolicy | null) => {
    const record = policies[use]
    if (!record) return
    const tools = { ...record.tools }
    if (policy === null) delete tools[toolName]
    else tools[toolName] = policy
    save({ ...policies, [use]: { ...record, tools } })
  }

  const unreviewed = connector.tools.filter(
    (tool) => tool.review.state !== 'reviewed' && tool.schemaSupported
  )

  const groups: Array<[ConnectorToolGroup, string]> = [
    ['read', 'Read-only tools'],
    ['write', 'Write tools'],
  ]

  return (
    <SettingsCard title="Tool permissions" contentClassName="p-0">
      {unreviewed.length > 0 && (
        <div className="border-b bg-amber-500/5 p-4">
          <h3 className="text-sm font-medium">Review before Quinn can use these</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {unreviewed.map((tool) => (
              <li key={tool.name}>
                <span className="font-medium text-foreground">{tool.title || tool.name}</span>{' '}
                {describeReview(tool)}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={review.isPending}
            onClick={() =>
              review.mutate(
                {
                  id: connector.id,
                  toolNames: unreviewed.map((tool) => tool.name),
                  expectedCatalogRevision: connector.catalogRevision,
                },
                {
                  onError: () =>
                    toast.error('This connection changed. Reload to see what it publishes now.'),
                }
              )
            }
          >
            Mark reviewed
          </Button>
        </div>
      )}

      <div className="hidden grid-cols-[minmax(0,1fr)_11rem_11rem] gap-3 border-b p-4 text-xs text-muted-foreground sm:grid">
        <span>Tool</span>
        {USES.map(([use, label]) => (
          <span key={use}>{label}</span>
        ))}
      </div>

      {groups.map(([group, label]) => {
        const tools = connector.tools.filter((tool) => tool.group === group)
        if (tools.length === 0) return null
        return (
          <div key={group}>
            <div className="grid gap-3 border-b bg-muted/40 p-4 sm:grid-cols-[minmax(0,1fr)_11rem_11rem] sm:items-center">
              <span className="text-[12.5px] font-semibold">{label}</span>
              {USES.map(([use]) => {
                const record = policies[use]
                return record ? (
                  <Select
                    key={use}
                    value={record.groupDefaults[group]}
                    onValueChange={(value) =>
                      setGroupDefault(use, group, value as ConnectorToolPolicy)
                    }
                  >
                    <SelectTrigger size="sm" aria-label={`${label} default`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['always', 'approval', 'never'] as const).map((policy) => (
                        <SelectItem key={policy} value={policy}>
                          {POLICY_LABELS[policy]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span key={use} className="text-xs text-muted-foreground">
                    Not available
                  </span>
                )
              })}
            </div>

            {tools.map((tool) => (
              <div
                key={tool.name}
                className="grid gap-3 border-b p-4 sm:grid-cols-[minmax(0,1fr)_11rem_11rem] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {tool.title || tool.name}
                    {tool.destructive && (
                      <Badge
                        size="sm"
                        className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400"
                      >
                        destructive
                      </Badge>
                    )}
                    {tool.review.state !== 'reviewed' && tool.schemaSupported && (
                      <Badge size="sm">Needs review</Badge>
                    )}
                    {!tool.schemaSupported && <Badge size="sm">Unsupported input</Badge>}
                  </div>
                  {tool.description && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {tool.description}
                    </p>
                  )}
                  {!tool.schemaSupported && tool.schemaIssue && (
                    <p className="mt-1 text-xs text-muted-foreground">{tool.schemaIssue}</p>
                  )}
                </div>
                {USES.map(([use, useLabel]) => {
                  const record = policies[use]
                  if (!tool.schemaSupported) {
                    return (
                      <span key={use} className="text-xs text-muted-foreground">
                        Unavailable
                      </span>
                    )
                  }
                  if (!record) {
                    return (
                      <span key={use} className="text-xs text-muted-foreground">
                        Not available
                      </span>
                    )
                  }
                  const override = record.tools[tool.name]
                  return (
                    <div key={use} className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground sm:hidden">{useLabel}</span>
                      <Select<string>
                        value={override ?? DEFAULT_VALUE}
                        onValueChange={(value) =>
                          setToolPolicy(
                            use,
                            tool.name,
                            value === DEFAULT_VALUE ? null : (value as ConnectorToolPolicy)
                          )
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`${tool.title || tool.name}: ${useLabel}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_VALUE}>
                            {POLICY_LABELS[record.groupDefaults[group]]} (default)
                          </SelectItem>
                          {(['always', 'approval', 'never'] as const).map((policy) => (
                            <SelectItem key={policy} value={policy}>
                              {POLICY_LABELS[policy]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}
    </SettingsCard>
  )
}
