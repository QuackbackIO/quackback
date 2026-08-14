import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { assistantQueries, assistantKeys } from '@/lib/client/queries/assistant'
import { updateAssistantToolRuleFn } from '@/lib/server/functions/assistant-settings'
import {
  resolveAssistantToolRule,
  type AssistantAgentKind,
  type AssistantToolRule,
} from '@/lib/shared/assistant/config'

const RULE_OPTIONS: Array<{ value: AssistantToolRule; labelId: string; defaultMessage: string }> = [
  {
    value: 'ask',
    labelId: 'automation.actions.rule.ask',
    defaultMessage: 'Ask for approval',
  },
  {
    value: 'allow',
    labelId: 'automation.actions.rule.allow',
    defaultMessage: 'Always allow',
  },
  {
    value: 'deny',
    labelId: 'automation.actions.rule.deny',
    defaultMessage: 'Deny',
  },
]

/**
 * Built-in Quinn tools as the first-party "Built-in" connector catalogue:
 * each write tool is permissioned Ask / Always allow / Deny (same vocabulary
 * as MCP Connectors). Read tools are listed for visibility but not gated.
 */
export function BuiltInActionsCard({ agent }: { agent: AssistantAgentKind }) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const toolsQuery = useQuery(assistantQueries.tools())
  const settingsQuery = useQuery(assistantQueries.settings())
  const [toolQuery, setToolQuery] = useState('')

  const title = intl.formatMessage({
    id: 'automation.actions.builtin.title',
    defaultMessage: 'Built-in',
  })

  const description = intl.formatMessage({
    id: 'automation.actions.builtin.description.permissions',
    defaultMessage:
      'Quinn’s built-in tools. Ask queues a teammate approval before the write runs. Always allow runs after the usual permission check. Deny hides the tool.',
  })

  const ruleMutation = useMutation({
    mutationFn: (input: {
      expectedRevision: number
      toolName: string
      rule: AssistantToolRule | null
    }) =>
      updateAssistantToolRuleFn({
        data: {
          expectedRevision: input.expectedRevision,
          agent,
          toolName: input.toolName,
          rule: input.rule,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.settings() })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : intl.formatMessage({
              id: 'automation.actions.builtin.ruleError',
              defaultMessage: 'Could not update tool permission',
            })
      )
    },
  })

  if (toolsQuery.isError) {
    return (
      <SettingsCard title={title}>
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.actions.builtin.loadError',
              defaultMessage: 'Built-in actions could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void toolsQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      </SettingsCard>
    )
  }

  if (toolsQuery.isPending || settingsQuery.isPending) {
    return (
      <SettingsCard title={title}>
        <p role="status" className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.actions.builtin.loading',
            defaultMessage: 'Loading built-in actions…',
          })}
        </p>
      </SettingsCard>
    )
  }

  const tools = toolsQuery.data ?? []
  const config = settingsQuery.data?.config
  const revision = settingsQuery.data?.revision
  const toolRules = config?.agents[agent].toolRules ?? {}
  const filter = toolQuery.trim().toLowerCase()
  const visibleTools =
    filter.length === 0
      ? tools
      : tools.filter((tool) =>
          `${tool.label} ${tool.name} ${tool.description}`.toLowerCase().includes(filter)
        )

  return (
    <SettingsCard title={title} description={description}>
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.actions.builtin.empty',
            defaultMessage: 'No built-in actions are available.',
          })}
        </p>
      ) : (
        <div className="space-y-3">
          {tools.length > 6 && (
            <Input
              value={toolQuery}
              onChange={(event) => setToolQuery(event.target.value)}
              placeholder={intl.formatMessage({
                id: 'automation.actions.builtin.filter',
                defaultMessage: 'Filter tools',
              })}
              aria-label={intl.formatMessage({
                id: 'automation.actions.builtin.filter',
                defaultMessage: 'Filter tools',
              })}
            />
          )}
          {visibleTools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.actions.builtin.filterEmpty',
                defaultMessage: 'No tools match that filter.',
              })}
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {visibleTools.map((tool) => {
                const saved = toolRules[tool.name]
                const effective = resolveAssistantToolRule(toolRules, tool.name, tool.risk, agent)
                const pending =
                  ruleMutation.isPending && ruleMutation.variables?.toolName === tool.name
                return (
                  <div key={tool.name} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium">{tool.label}</h3>
                        <Badge
                          size="sm"
                          variant={tool.risk === 'write' ? 'outline' : 'secondary'}
                          shape="pill"
                        >
                          {tool.risk === 'write'
                            ? intl.formatMessage({
                                id: 'automation.actions.builtin.risk.write',
                                defaultMessage: 'Write',
                              })
                            : intl.formatMessage({
                                id: 'automation.actions.builtin.risk.read',
                                defaultMessage: 'Read',
                              })}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                    {tool.risk === 'write' && typeof revision === 'number' ? (
                      <div className="flex items-center gap-2">
                        {saved ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              ruleMutation.mutate({
                                expectedRevision: revision,
                                toolName: tool.name,
                                rule: null,
                              })
                            }
                          >
                            {intl.formatMessage({
                              id: 'automation.actions.builtin.resetRule',
                              defaultMessage: 'Reset',
                            })}
                          </Button>
                        ) : null}
                        <Select
                          value={effective}
                          disabled={pending}
                          onValueChange={(value) =>
                            ruleMutation.mutate({
                              expectedRevision: revision,
                              toolName: tool.name,
                              rule: value as AssistantToolRule,
                            })
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
                    ) : (
                      <Badge size="sm" variant="secondary" shape="pill">
                        {intl.formatMessage({
                          id: 'automation.actions.builtin.alwaysOn',
                          defaultMessage: 'Always on',
                        })}
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  )
}
