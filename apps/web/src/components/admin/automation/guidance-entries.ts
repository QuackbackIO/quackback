import { assistantGuidanceAgentSchema } from '@/lib/shared/assistant/guidance'
import type { AssistantAgentKind, AssistantConfig } from '@/lib/shared/assistant/config'
import type { SkillDTO } from '@/lib/shared/assistant/skills'
import type { AssistantGuidanceRule } from '@/lib/server/domains/assistant/guidance.service'

export type GuidanceEntry = {
  key: string
  name: string
  instruction: string
  condition: string | null
  uses: AssistantAgentKind[]
  enabled: boolean
} & (
  | { source: 'voice'; revision: number; voice: AssistantConfig['agents']['agent']['voice'] }
  | { source: 'rule'; rule: AssistantGuidanceRule }
  | { source: 'skill'; skill: SkillDTO }
  | { source: 'managed' }
)

/** Presentation only: retain every legacy record, complete body and exact scope. */
export function guidanceEntries(
  config: AssistantConfig,
  revision: number,
  rules: AssistantGuidanceRule[],
  skills: SkillDTO[]
): GuidanceEntry[] {
  return [
    {
      key: 'voice:agent',
      source: 'voice',
      revision,
      voice: config.agents.agent.voice,
      name: 'Everyday instructions',
      instruction: config.agents.agent.voice.additionalInstructions,
      condition: null,
      uses: ['agent'],
      enabled: true,
    },
    ...rules.map((rule): GuidanceEntry => ({
      key: `rule:${rule.id}`,
      source: 'rule',
      rule,
      name: rule.name,
      instruction: rule.instruction,
      condition: rule.appliesWhen,
      uses: [assistantGuidanceAgentSchema.parse(rule.agent)],
      enabled: rule.enabled,
    })),
    ...skills.map((skill): GuidanceEntry => ({
      key: `skill:${skill.id}`,
      source: 'skill',
      skill,
      name: skill.name,
      instruction: skill.instructions,
      condition: skill.whenToUse,
      uses: (['agent', 'copilot', 'workspace'] as const).filter((use) => skill.assignments[use]),
      enabled: skill.enabled,
    })),
    {
      key: 'managed:workspace',
      source: 'managed',
      name: 'Workspace and Slack instructions',
      instruction: config.agents.workspace.instructions,
      condition: null,
      uses: ['workspace'],
      enabled: true,
    },
  ]
}

export const GUIDANCE_USE_LABELS: Record<AssistantAgentKind, string> = {
  agent: 'Customer conversations',
  copilot: 'Support teammates',
  workspace: 'Workspace and Slack',
}
