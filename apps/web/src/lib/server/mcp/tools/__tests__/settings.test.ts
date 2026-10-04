import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const state = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
  reads: [] as string[],
  proposals: [] as unknown[],
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: async (flag: string) => state.flags[flag] === true,
}))
vi.mock('../../resolve-actor', () => ({
  resolveMcpActor: async (_auth: unknown, scope: string) => ({ scope }),
}))
vi.mock('@/lib/server/domains/assistant/settings-proposals.service', () => ({
  getSettingsForActor: async (actor: { scope: string }, area: string) => {
    state.reads.push(`${actor.scope}:${area}`)
    return { area, settings: {} }
  },
}))
vi.mock('@/lib/server/domains/assistant/workspace-settings-actions.service', () => ({
  enqueueWorkspaceSettingsProposal: async (_actor: unknown, changes: unknown) => {
    state.proposals.push(changes)
    return { id: 'assistant_action_1', args: { changes } }
  },
}))

import { registerSettingsTools } from '../settings'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerSettingsTools(
    fakeServer as never,
    {
      principalId: 'principal_member',
      name: 'Acme',
      role: 'member',
      authMethod: 'oauth',
      scopes: ['read:settings', 'write:settings'],
    } as unknown as McpAuthContext
  )
  return handlers
}

const text = (result: CallToolResult) => (result.content[0] as { text: string }).text

beforeEach(() => {
  state.flags = {}
  state.reads = []
  state.proposals = []
})

describe('settings MCP tools follow Copilot on Home', () => {
  it('refuse to read or propose while the flag is off', async () => {
    const tools = collect()
    const read = await tools.get('get_settings')!({ area: 'branding' })
    const propose = await tools.get('propose_settings_change')!({
      changes: [{ area: 'messenger', patch: { enabled: true } }],
    })
    for (const result of [read, propose]) {
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Settings → Labs')
    }
    expect(state.reads).toEqual([])
    expect(state.proposals).toEqual([])
  })

  it('work once the flag is on', async () => {
    state.flags = { copilotHome: true }
    const tools = collect()
    expect((await tools.get('get_settings')!({ area: 'branding' })).isError).not.toBe(true)
    expect(state.reads).toEqual(['read:settings:branding'])
    const propose = await tools.get('propose_settings_change')!({
      changes: [{ area: 'messenger', patch: { enabled: true } }],
    })
    expect(propose.isError).not.toBe(true)
    expect(state.proposals).toEqual([[{ area: 'messenger', patch: { enabled: true } }]])
  })
})
