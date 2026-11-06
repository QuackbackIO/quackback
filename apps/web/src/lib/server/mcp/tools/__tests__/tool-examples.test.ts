import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: async () => true,
  getFeatureFlags: async () => ({}),
}))
vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: async () => null,
}))

import { registerSettingsTools } from '../settings'
import { registerNavigationTools } from '../navigation'
import { WORKSPACE_WEB_PROMPT } from '@/lib/server/domains/assistant/workspace-prompt'
import type { McpAuthContext } from '../../types'

/** Every JSON object written into a piece of model-facing text. */
function jsonExamples(text: string): unknown[] {
  const examples: unknown[] = []
  for (let start = text.indexOf('{"'); start !== -1; start = text.indexOf('{"', start + 1)) {
    for (let end = text.indexOf('}', start); end !== -1; end = text.indexOf('}', end + 1)) {
      try {
        examples.push(JSON.parse(text.slice(start, end + 1)))
        start = end
        break
      } catch {
        // Not balanced yet: extend to the next closing brace.
      }
    }
  }
  return examples
}

function registered() {
  const tools: Array<{ name: string; description: string; schema: z.ZodRawShape }> = []
  const server = {
    tool: (name: string, description: string, schema: z.ZodRawShape) => {
      tools.push({ name, description, schema })
    },
  }
  const auth = {
    principalId: 'principal_member',
    name: 'Acme',
    role: 'member',
    authMethod: 'oauth',
    scopes: ['read:settings', 'write:settings'],
  } as unknown as McpAuthContext
  registerSettingsTools(server as never, auth)
  registerNavigationTools(server as never, auth)
  return tools
}

describe('model-facing tool examples', () => {
  it.each(registered().map((tool) => [tool.name, tool] as const))(
    '%s examples parse with its input schema',
    (_name, tool) => {
      const examples = jsonExamples(tool.description)
      expect(examples.length).toBeGreaterThan(0)
      for (const example of examples) expect(z.object(tool.schema).parse(example)).toBeTruthy()
    }
  )

  it('Home prompt tool examples parse with their tool schemas', () => {
    const tools = new Map(registered().map((tool) => [tool.name, z.object(tool.schema)]))
    const calls = jsonExamples(WORKSPACE_WEB_PROMPT).filter(
      (example) =>
        typeof example === 'object' &&
        example !== null &&
        ('destination' in example || 'area' in example)
    )
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls)
      tools
        .get('destination' in (call as object) ? 'navigate_workspace' : 'get_settings')!
        .parse(call)
  })

  it('finds a broken example', () => {
    const [example] = jsonExamples('Example: {"destination":"billing_portal"}')
    const navigation = registered().find((tool) => tool.name === 'navigate_workspace')!
    expect(z.object(navigation.schema).safeParse(example).success).toBe(false)
  })
})
