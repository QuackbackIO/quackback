/**
 * Per-tool permission dials for Quinn's BUILT-IN write tools, one card per
 * agent, sharing the remote-connector dial's vocabulary and control:
 * Always allow / Needs approval / Never. An absent rule leaves the turn's
 * role policy deciding, so the dial shows that default until a teammate
 * commits an explicit choice; Reset returns every tool to role policy.
 *
 * Read tools are deliberately not listed — the dial exists for writes, and a
 * read tool that could be denied would quietly hollow out answer quality.
 */
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { PolicyDial } from '@/components/admin/automation/connectors/policy-dial'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantToolRules } from '@/lib/client/mutations/assistant'
import type { ConnectorToolPolicy } from '@/lib/shared/assistant/connectors'
import type { AssistantAgentKind, AssistantToolRule } from '@/lib/shared/assistant/config'

/** The dial renders the connector vocabulary; rules persist the built-in one. */
const RULE_TO_DIAL: Record<AssistantToolRule, ConnectorToolPolicy> = {
  allow: 'always',
  ask: 'approval',
  deny: 'never',
}
const DIAL_TO_RULE: Record<ConnectorToolPolicy, AssistantToolRule> = {
  always: 'allow',
  approval: 'ask',
  never: 'deny',
}

/** What role policy does when no rule is saved (D14). */
function roleDefault(agent: AssistantAgentKind): AssistantToolRule {
  return agent === 'copilot' ? 'ask' : 'allow'
}

export function BuiltInToolsCard({ agent }: { agent: AssistantAgentKind }) {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const toolsQuery = useQuery(assistantQueries.tools())
  const update = useUpdateAssistantToolRules()
  const [pendingTool, setPendingTool] = useState<string | null>(null)

  if (settingsQuery.isError || toolsQuery.isError) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.builtinTools.title',
          defaultMessage: 'Built-in actions',
        })}
      >
        <p className="text-sm text-destructive">
          {intl.formatMessage({
            id: 'automation.builtinTools.loadError',
            defaultMessage: 'Could not load the tool catalogue.',
          })}
        </p>
      </SettingsCard>
    )
  }
  if (settingsQuery.isPending || toolsQuery.isPending) return null

  const revision = settingsQuery.data.revision
  const rules = settingsQuery.data.config.agents[agent].toolRules
  const writeTools = toolsQuery.data.filter((tool) => tool.risk === 'write')
  const hasExplicitRules = Object.keys(rules).length > 0

  async function save(toolRules: Record<string, AssistantToolRule>, tool: string | null) {
    setPendingTool(tool)
    try {
      await update.mutateAsync({ expectedRevision: revision, agent, toolRules })
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'automation.builtinTools.saveError',
          defaultMessage: 'Tool permissions could not be updated.',
        })
      )
    } finally {
      setPendingTool(null)
    }
  }

  return (
    <SettingsCard
      title={
        agent === 'copilot'
          ? intl.formatMessage({
              id: 'automation.builtinTools.titleCopilot',
              defaultMessage: 'Built-in actions (Copilot)',
            })
          : intl.formatMessage({
              id: 'automation.builtinTools.titleAgent',
              defaultMessage: 'Built-in actions (Agent)',
            })
      }
      description={intl.formatMessage({
        id: 'automation.builtinTools.description',
        defaultMessage:
          'What each built-in write tool may do on this agent. "Never" removes the tool from its turns entirely.',
      })}
      action={
        hasExplicitRules ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => void save({}, null)}
          >
            {intl.formatMessage({
              id: 'automation.builtinTools.reset',
              defaultMessage: 'Reset to defaults',
            })}
          </Button>
        ) : undefined
      }
      contentClassName="p-0"
    >
      {writeTools.map((tool, index) => {
        const effective = rules[tool.name] ?? roleDefault(agent)
        const explicit = tool.name in rules
        return (
          <div
            key={tool.name}
            className={
              index === 0
                ? 'flex items-center gap-3 px-4 py-3 sm:px-[18px]'
                : 'flex items-center gap-3 border-t border-border/60 px-4 py-3 sm:px-[18px]'
            }
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                {tool.label}
                {!explicit && (
                  <span className="text-[11px] text-muted-foreground">
                    {intl.formatMessage({
                      id: 'automation.builtinTools.default',
                      defaultMessage: 'Default',
                    })}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
            </div>
            {pendingTool === tool.name ? (
              <span className="text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.builtinTools.saving',
                  defaultMessage: 'Saving…',
                })}
              </span>
            ) : null}
            <PolicyDial
              value={RULE_TO_DIAL[effective]}
              labelledBy={tool.label}
              onChange={(next) =>
                void save({ ...rules, [tool.name]: DIAL_TO_RULE[next] }, tool.name)
              }
            />
          </div>
        )
      })}
    </SettingsCard>
  )
}
