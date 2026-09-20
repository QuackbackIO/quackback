import { getAssistantConfig } from '@/lib/server/domains/settings/settings.assistant'
import type { AssistantAgentKind } from '@/lib/shared/assistant/config'
import { applyBuiltInToolRules, getToolSpecByName, resolveToolSpecs } from './assistant.toolspec'

/** Tool authority is live even when a run's behavior comes from a release. */
export async function resolveLiveBuiltInToolSpecs(agent: AssistantAgentKind) {
  const { config } = await getAssistantConfig()
  return applyBuiltInToolRules(resolveToolSpecs(), config.agents[agent].toolRules)
}

export async function getLiveBuiltInToolSpec(name: string, agent: AssistantAgentKind) {
  const spec = getToolSpecByName(name)
  if (!spec) return null
  const { config } = await getAssistantConfig()
  return applyBuiltInToolRules([spec], config.agents[agent].toolRules)[0] ?? null
}
