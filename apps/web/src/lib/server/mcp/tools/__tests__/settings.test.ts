import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const state = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
  reads: [] as string[],
  proposals: [] as unknown[],
  changes: [] as unknown[],
  change: { status: 'noop', revision: 'rev' } as Record<string, unknown>,
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
vi.mock('@/lib/server/domains/settings-registry/service', () => ({
  readSettingsArea: async (_actor: unknown, area: string) => ({
    id: area,
    risk: 'low',
    revision: 'rev',
    locked: [],
    gates: { permission: 'settings.branding' },
    value: {},
  }),
  listSettingsAreas: async () => [{ id: 'branding', risk: 'low', revision: 'rev' }],
  changeSettingsArea: async (_caller: unknown, area: string, input: unknown) => {
    state.changes.push({ area, input })
    return state.change
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

function collect(overrides: Partial<McpAuthContext> = {}): Map<string, Handler> {
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
      // A member whose custom role grants the settings areas these tools touch.
      permissions: new Set(['settings.branding', 'settings.manage']),
      authMethod: 'oauth',
      scopes: ['read:settings', 'write:settings'],
      ...overrides,
    } as unknown as McpAuthContext
  )
  return handlers
}

const text = (result: CallToolResult) => (result.content[0] as { text: string }).text

beforeEach(() => {
  state.flags = {}
  state.reads = []
  state.proposals = []
  state.changes = []
  state.change = { status: 'noop', revision: 'rev' }
})

describe('settings MCP tools follow Copilot on Home', () => {
  it('refuses to propose while the flag is off, but reads and updates need no flag', async () => {
    const tools = collect()
    const propose = await tools.get('propose_settings_change')!({
      changes: [{ area: 'messenger', patch: { enabled: true } }],
    })
    expect(propose.isError).toBe(true)
    expect(text(propose)).toContain('Settings → Labs')
    expect(state.proposals).toEqual([])
    expect((await tools.get('get_settings')!({ area: 'branding' })).isError).not.toBe(true)
    const update = await tools.get('update_settings')!({
      area: 'portal',
      patch: { displayName: 'Acme' },
      dry_run: true,
    })
    expect(update.isError).not.toBe(true)
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

  it('lists the areas with no area given, and an area with its revision', async () => {
    state.flags = { copilotHome: true }
    const tools = collect()
    expect(JSON.parse(text(await tools.get('get_settings')!({})))).toMatchObject({
      areas: [{ id: 'branding', revision: 'rev' }],
    })
    expect(JSON.parse(text(await tools.get('get_settings')!({ area: 'branding' })))).toMatchObject({
      area: 'branding',
      revision: 'rev',
      risk: 'low',
      locked: [],
    })
  })

  it('update_settings needs a revision unless it is a dry run', async () => {
    state.flags = { copilotHome: true }
    const tools = collect()
    const refused = await tools.get('update_settings')!({
      area: 'portal',
      patch: { displayName: 'Acme' },
    })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('IF_MATCH_REQUIRED')
    expect(state.changes).toEqual([])

    await tools.get('update_settings')!({
      area: 'portal',
      patch: { displayName: 'Acme' },
      dry_run: true,
    })
    expect(state.changes).toEqual([
      {
        area: 'portal',
        input: { patch: { displayName: 'Acme' }, expectedRevision: undefined, dryRun: true },
      },
    ])
  })

  it('update_settings applies a medium-risk change and returns its receipt', async () => {
    const receipt = { id: 'audit_1', area: 'messenger', revision: 'rev2', undoable: true }
    state.change = { status: 'applied', receipt }
    const result = await collect().get('update_settings')!({
      area: 'messenger',
      patch: { enabled: true },
      expected_revision: 'rev',
    })
    expect(JSON.parse(text(result))).toMatchObject({ status: 'applied', receipt })
    expect(state.proposals).toEqual([])
  })

  it('offers a settings card only to the in-app assistant, not to an outside client', () => {
    const outside = collect({ auditAttribution: { channel: 'mcp' } as never })
    expect(outside.has('update_settings')).toBe(true)
    expect(outside.has('propose_settings_change')).toBe(false)
    expect(collect().has('propose_settings_change')).toBe(true)
  })
})
