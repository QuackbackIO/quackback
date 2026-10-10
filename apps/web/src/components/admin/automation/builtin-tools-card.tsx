/**
 * Per-tool permission dials for Quinn's BUILT-IN write tools: one card whose
 * Agent / Copilot switch picks the agent being edited, sharing the
 * remote-connector dial's control (Allow / Ask / Never). An absent rule
 * leaves the turn's role policy deciding, so the dial shows that policy until
 * a teammate commits an explicit choice; Reset returns every tool to role
 * policy.
 *
 * Read tools are deliberately not listed — the dial exists for writes, and a
 * read tool that could be denied would quietly hollow out answer quality.
 */
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SegmentedControl } from '@/components/shared/segmented-control'
import { PolicyDial } from '@/components/admin/automation/connectors/policy-dial'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantToolRules } from '@/lib/client/mutations/assistant'
import { useUnsavedChanges } from './assistant-form'
import { useAssistantSave } from './assistant-save-queue'
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

type TenantEditableAgent = Exclude<AssistantAgentKind, 'workspace'>

/** What role policy does when no rule is saved (D14). */
function roleDefault(agent: TenantEditableAgent): AssistantToolRule {
  return agent === 'copilot' ? 'ask' : 'allow'
}

const AGENT_OPTIONS: ReadonlyArray<{ value: TenantEditableAgent; label: string }> = [
  { value: 'agent', label: 'Agent' },
  { value: 'copilot', label: 'Copilot' },
]

export function BuiltInToolsCard() {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const toolsQuery = useQuery(assistantQueries.tools())
  const update = useUpdateAssistantToolRules()
  const saveQueued = useAssistantSave()
  const [agent, setAgent] = useState<TenantEditableAgent>('agent')
  const [pending, setPending] = useState(0)
  useUnsavedChanges(pending > 0)
  const title = intl.formatMessage({
    id: 'automation.builtinTools.title',
    defaultMessage: 'Built-in actions',
  })

  if (settingsQuery.isError || toolsQuery.isError) {
    return (
      <SettingsCard title={title}>
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

  const rules = settingsQuery.data.config.agents[agent].toolRules
  const writeTools = toolsQuery.data.filter((tool) => tool.risk === 'write')
  const hasExplicitRules = Object.keys(rules).length > 0

  // `change` builds the next rules from the latest saved ones, so a pick made
  // before an earlier save finishes does not drop that save's rule.
  function save(
    change: (current: Record<string, AssistantToolRule>) => Record<string, AssistantToolRule>
  ) {
    setPending((count) => count + 1)
    void saveQueued((latest) =>
      update.mutateAsync({
        expectedRevision: latest.revision,
        agent,
        toolRules: change(latest.config.agents[agent].toolRules),
      })
    )
      // The autosave handler shows the failure toast.
      .catch(() => {})
      .finally(() => setPending((count) => count - 1))
  }

  return (
    <SettingsCard
      title={title}
      action={
        <div className="flex items-center gap-2">
          {hasExplicitRules && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => save(() => ({}))}
            >
              {intl.formatMessage({
                id: 'automation.builtinTools.reset',
                defaultMessage: 'Reset to defaults',
              })}
            </Button>
          )}
          <SegmentedControl
            label={intl.formatMessage({
              id: 'automation.builtinTools.agent',
              defaultMessage: 'Agent',
            })}
            options={AGENT_OPTIONS}
            value={agent}
            onChange={setAgent}
          />
        </div>
      }
    >
      <SettingRows>
        {writeTools.map((tool) => {
          const effective = rules[tool.name] ?? roleDefault(agent)
          return (
            <SettingRow
              key={tool.name}
              label={tool.label}
              description={tool.description}
              control={
                <PolicyDial
                  value={RULE_TO_DIAL[effective]}
                  labelledBy={tool.label}
                  onChange={(next) =>
                    save((current) => ({ ...current, [tool.name]: DIAL_TO_RULE[next] }))
                  }
                />
              }
            />
          )
        })}
      </SettingRows>
    </SettingsCard>
  )
}
