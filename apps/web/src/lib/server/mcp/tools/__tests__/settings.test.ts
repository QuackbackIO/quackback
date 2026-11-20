import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/server'

const state = vi.hoisted(() => ({
  reads: [] as string[],
  changes: [] as unknown[],
  change: { status: 'noop', revision: 'rev' } as Record<string, unknown>,
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
    revision: 'rev',
    locked: [],
    gates: { permission: 'settings.branding' },
    value: {},
  }),
  listSettingsAreas: async () => [{ id: 'branding', revision: 'rev' }],
  // The real service checks the credential's scope for the area before it
  // changes anything; the tool supplies that check.
  changeSettingsArea: async (
    caller: { assertAreaScope?: (area: string) => void },
    area: string,
    input: unknown
  ) => {
    caller.assertAreaScope?.(area)
    state.changes.push({ area, input })
    return state.change
  },
}))

import { registerSettingsTools } from '../settings'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(overrides: Partial<McpAuthContext> = {}): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    registerTool: (name: string, _c: unknown, handler: Handler) => {
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
  state.reads = []
  state.changes = []
  state.change = { status: 'noop', revision: 'rev' }
})

describe('settings MCP tools', () => {
  it('read and update with no feature flag', async () => {
    const tools = collect()
    expect((await tools.get('get_settings')!({ area: 'branding' })).isError).not.toBe(true)
    expect(state.reads).toEqual(['read:settings:branding'])
    const update = await tools.get('update_settings')!({
      area: 'portal',
      patch: { displayName: 'Acme' },
      dry_run: true,
    })
    expect(update.isError).not.toBe(true)
  })

  it('lists the areas with no area given, and an area with its revision', async () => {
    const tools = collect()
    expect(JSON.parse(text(await tools.get('get_settings')!({})))).toMatchObject({
      areas: [{ id: 'branding', revision: 'rev' }],
    })
    expect(JSON.parse(text(await tools.get('get_settings')!({ area: 'branding' })))).toMatchObject({
      area: 'branding',
      revision: 'rev',
      locked: [],
    })
    expect(
      JSON.parse(text(await tools.get('get_settings')!({ area: 'branding' })))
    ).not.toHaveProperty('risk')
  })

  it('update_settings needs a revision unless it is a dry run', async () => {
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

  it('update_settings applies a change and returns its receipt', async () => {
    const receipt = { id: 'audit_1', area: 'messenger', revision: 'rev2', undoable: true }
    state.change = { status: 'applied', receipt }
    const result = await collect().get('update_settings')!({
      area: 'messenger',
      patch: { enabled: true },
      expected_revision: 'rev',
    })
    expect(JSON.parse(text(result))).toMatchObject({ status: 'applied', receipt })
  })

  it('update_settings refuses an area whose own scope the credential lacks, as REST does', async () => {
    const tools = collect({
      permissions: new Set(['settings.branding', 'settings.manage', 'changelog.manage']),
      authMethod: 'api-key',
    } as never)
    const refused = await tools.get('update_settings')!({
      area: 'changelog',
      patch: { autoSubscribe: true },
      expected_revision: 'rev',
    })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toBe(
      "Error: This API key is missing the 'write:changelog' scope required by 'changelog.manage' (code: FORBIDDEN)"
    )
    expect(state.changes).toEqual([])

    const granted = collect({
      permissions: new Set(['changelog.manage']),
      scopes: ['write:settings', 'write:changelog'],
    } as never)
    const applied = await granted.get('update_settings')!({
      area: 'changelog',
      patch: { autoSubscribe: true },
      expected_revision: 'rev',
    })
    expect(applied.isError).not.toBe(true)
    expect(state.changes).toHaveLength(1)
  })

  it('never offers a settings card, in the app or to an outside client', () => {
    const outside = collect({ auditAttribution: { channel: 'mcp' } as never })
    expect(outside.has('update_settings')).toBe(true)
    expect(outside.has('propose_settings_change')).toBe(false)
    expect(collect().has('propose_settings_change')).toBe(false)
  })
})
