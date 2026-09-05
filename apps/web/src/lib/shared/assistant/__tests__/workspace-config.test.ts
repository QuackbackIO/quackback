import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_CONFIG,
  migrateAssistantConfig,
  roleToAgent,
  assistantConfigSchema,
} from '../config'
import { resolveContentAudience } from '@/lib/server/domains/assistant/audience'
import { resolveAssistantRolePolicy } from '@/lib/server/domains/assistant/assistant.system-prompt'
describe('workspace assistant configuration and trust boundary', () => {
  it('migrates v3 without changing existing agent choices', () => {
    const old = { ...structuredClone(DEFAULT_ASSISTANT_CONFIG), version: 3 } as any
    delete old.agents.workspace
    old.agents.copilot.knowledge.posts = false
    const migrated = assistantConfigSchema.parse(migrateAssistantConfig(old))
    expect(migrated.version).toBe(4)
    expect(migrated.agents.copilot.knowledge.posts).toBe(false)
    expect(migrated.agents.workspace.slack.enabled).toBe(false)
  })
  it('maps workspace to its own knowledge and a team-only proposing role', () => {
    expect(roleToAgent('workspace_assistant')).toBe('workspace')
    expect(resolveContentAudience('slack')).toBe('team')
    expect(resolveContentAudience('workspace')).toBe('team')
    expect(resolveAssistantRolePolicy('workspace_assistant')).toMatchObject({
      contentAudience: 'team',
      writeToolPolicy: 'propose',
      customerVoice: false,
    })
  })
  it('does not permit unlinked public Q&A in v1', () => {
    const config = structuredClone(DEFAULT_ASSISTANT_CONFIG)
    config.agents.workspace.slack.allowUnlinkedPublicQa = true as any
    expect(assistantConfigSchema.safeParse(config).success).toBe(false)
  })
})
