import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { useUpdateAssistantToolRules } from '@/lib/client/mutations/assistant'
import type { AssistantToolRule } from '@/lib/shared/assistant/config'
import { isAssistantFieldManaged } from './assistant-form'

const USES = [
  ['agent', 'Customer conversations'],
  ['copilot', 'Support teammates'],
] as const

/** Both columns write the existing independently authorized per-use policies. */
export function BuiltInToolsCard() {
  const settings = useQuery(assistantQueries.settings())
  const tools = useQuery(assistantQueries.tools())
  const update = useUpdateAssistantToolRules()
  if (settings.isError || tools.isError)
    return <p role="alert">Built-in actions could not be loaded.</p>
  if (!settings.data || !tools.data) return <p role="status">Loading built-in actions…</p>
  const { config, revision, managedFieldPaths } = settings.data
  const writeTools = tools.data.filter((tool) => tool.risk === 'write')

  return (
    <SettingsCard
      title="Quackback built-in actions"
      description="No external connection needed. Each use has its own permissions."
      contentClassName="p-0"
    >
      <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_11rem_11rem] gap-3 border-b p-4 text-xs text-muted-foreground">
        <span>Action</span>
        <span>Customer conversations</span>
        <span>Support teammates</span>
      </div>
      {writeTools.map((tool) => (
        <div
          key={tool.name}
          className="grid gap-3 border-b last:border-b-0 p-4 sm:grid-cols-[minmax(0,1fr)_11rem_11rem] sm:items-center"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{tool.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
          </div>
          {USES.map(([agent, label]) => {
            const rules = config.agents[agent].toolRules
            const effective = rules[tool.name] ?? (agent === 'copilot' ? 'ask' : 'allow')
            const managed = isAssistantFieldManaged(
              managedFieldPaths,
              `agents.${agent}.toolRules.${tool.name}`
            )
            return (
              <label key={agent} className="flex flex-col gap-1 text-xs">
                <span className="sm:hidden">{label}</span>
                <select
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  aria-label={`${tool.label}: ${label}`}
                  value={effective}
                  disabled={managed || update.isPending}
                  onChange={(event) => {
                    const toolRules = { ...rules }
                    if (event.target.value === 'default') delete toolRules[tool.name]
                    else toolRules[tool.name] = event.target.value as AssistantToolRule
                    update.mutate(
                      {
                        expectedRevision: revision,
                        agent,
                        toolRules,
                      },
                      {
                        onError: () =>
                          toast.error(
                            'Action permissions could not be updated. Refresh and try again.'
                          ),
                      }
                    )
                  }}
                >
                  <option value="default">Reset to default</option>
                  <option value="allow">Always allow</option>
                  <option value="ask">Needs approval</option>
                  <option value="deny">Never</option>
                </select>
                {managed ? (
                  <span className="text-muted-foreground">Managed</span>
                ) : (
                  !(tool.name in rules) && <span className="text-muted-foreground">Default</span>
                )}
              </label>
            )
          })}
        </div>
      ))}
      <p className="border-t p-4 text-xs text-muted-foreground">
        Saved permissions take effect immediately. Instructions cannot grant additional access.
      </p>
    </SettingsCard>
  )
}
