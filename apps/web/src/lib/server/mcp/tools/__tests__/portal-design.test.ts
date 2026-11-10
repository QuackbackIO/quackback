/**
 * The portal design MCP tools: a person with the branding permission reads
 * the design and edits its draft; a stale revision and a broken design come
 * back as errors the client can act on. No tool publishes: a person does that
 * in the app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const state = vi.hoisted(() => ({
  patchResult: { ok: true } as unknown,
  patches: [] as unknown[],
  engine: 'v2' as 'v2' | 'legacy',
  opsResult: { ok: true, applied: [0], refused: [], revision: 'rev3' } as unknown,
  opsCalls: [] as unknown[],
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => ({ portalDesign: { engine: state.engine } }),
  isFeatureEnabled: async () => true,
}))

vi.mock('../../resolve-actor', () => ({
  resolveMcpActor: async () => ({ principalId: 'principal_member', role: 'member' }),
}))
vi.mock('@/lib/server/domains/design/design.actions', () => ({
  readDesignForEditing: async () => ({ design: {}, source: 'draft', revision: 'rev2' }),
  patchDesignDraft: async (
    patch: unknown,
    author: unknown,
    expected: unknown,
    options: unknown
  ) => {
    state.patches.push({ patch, author, expected, options })
    return state.patchResult
  },
}))
vi.mock('@/lib/server/domains/design/draft-ops', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/design/draft-ops')>()),
  applyDraftOps: async (ops: unknown, _author: unknown, expected: unknown, gates: unknown) => {
    state.opsCalls.push({ ops, expected, gates })
    return state.opsResult
  },
}))
vi.mock('@/lib/server/domains/design/workspace-gates', () => ({
  workspaceGates: async () => ({ help: true }),
}))

import { registerPortalDesignTools } from '../portal-design'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(permissions: string[]): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerPortalDesignTools(
    fakeServer as never,
    {
      principalId: 'principal_member',
      name: 'Acme',
      role: 'member',
      permissions: new Set(permissions),
      authMethod: 'oauth',
      scopes: ['read:settings', 'write:settings'],
    } as unknown as McpAuthContext
  )
  return handlers
}

const text = (result: CallToolResult) => (result.content[0] as { text: string }).text

beforeEach(() => {
  state.engine = 'v2'
  state.patchResult = { ok: true }
  state.patches = []
  state.opsResult = { ok: true, applied: [0], refused: [], revision: 'rev3' }
  state.opsCalls = []
})

describe('portal design MCP tools', () => {
  it('give examples that parse with the draft tool’s schema', () => {
    const tools: Array<{ name: string; description: string; schema: z.ZodRawShape }> = []
    registerPortalDesignTools(
      {
        tool: (name: string, description: string, schema: z.ZodRawShape) =>
          tools.push({ name, description, schema }),
      } as never,
      { principalId: 'principal_member', role: 'member', scopes: [] } as unknown as McpAuthContext
    )
    for (const name of ['update_portal_design_draft', 'apply_portal_design_ops']) {
      const tool = tools.find((each) => each.name === name)!
      const examples = tool.description.split('\n').filter((line) => line.startsWith('{"'))
      expect(examples.length).toBeGreaterThan(0)
      for (const example of examples) z.object(tool.schema).parse(JSON.parse(example))
    }
  })

  it('need the branding permission', async () => {
    const tools = collect(['settings.manage'])
    expect((await tools.get('get_portal_design')!({})).isError).toBe(true)
  })

  it('edit the draft against the revision the client read', async () => {
    const tools = collect(['settings.branding'])
    const result = await tools.get('update_portal_design_draft')!({
      patch: { layout: { density: 'compact' } },
      expected_revision: 'rev1',
    })
    expect(result.isError).not.toBe(true)
    expect(text(result)).toContain('rev2')
    expect(state.patches).toEqual([
      expect.objectContaining({ patch: { layout: { density: 'compact' } }, expected: 'rev1' }),
    ])
  })

  it('report a stale revision and a broken design as errors', async () => {
    const tools = collect(['settings.branding'])
    state.patchResult = { ok: false, code: 'REVISION_MISMATCH', message: 'Read it again' }
    const stale = await tools.get('update_portal_design_draft')!({
      patch: {},
      expected_revision: 'old',
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('Read it again')
    state.patchResult = { ok: false, code: 'UNREADABLE_DESIGN', message: 'ink on background' }
    const broken = await tools.get('update_portal_design_draft')!({
      patch: {},
      expected_revision: 'rev2',
    })
    expect(broken.isError).toBe(true)
  })

  it('offer no tool that publishes', () => {
    expect([...collect(['settings.branding']).keys()].sort()).toEqual([
      'apply_portal_design_ops',
      'get_portal_design',
      'update_portal_design_draft',
    ])
  })

  it('pass replace through to the merge patch', async () => {
    const tools = collect(['settings.branding'])
    await tools.get('update_portal_design_draft')!({
      patch: { overrides: [] },
      expected_revision: 'rev1',
      replace: true,
    })
    expect(state.patches).toMatchObject([{ options: { replace: true } }])
  })

  it('report an array patch without replace as an error', async () => {
    const tools = collect(['settings.branding'])
    state.patchResult = { ok: false, code: 'REPLACE_REQUIRED', message: 'Send replace: true' }
    const result = await tools.get('update_portal_design_draft')!({
      patch: { overrides: [] },
      expected_revision: 'rev1',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Send replace: true')
  })

  it('apply ops against the revision and say which were refused', async () => {
    const tools = collect(['settings.branding'])
    state.opsResult = {
      ok: true,
      applied: [1],
      refused: [{ index: 0, reason: 'That block is no longer on Home' }],
      revision: 'rev3',
    }
    const ops = [
      { op: 'block.remove', block: 'gone0001' },
      { op: 'block.step', id: 'ideas001', by: 1 },
    ]
    const result = await tools.get('apply_portal_design_ops')!({ ops, expected_revision: 'rev2' })
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(text(result))).toMatchObject({
      applied: [1],
      refused: [{ index: 0, reason: 'That block is no longer on Home' }],
      revision: 'rev3',
    })
    expect(state.opsCalls).toEqual([{ ops, expected: 'rev2', gates: { help: true } }])
  })

  it('report a stale revision for ops as an error', async () => {
    const tools = collect(['settings.branding'])
    state.opsResult = { ok: false, code: 'REVISION_MISMATCH', message: 'Read it again' }
    const result = await tools.get('apply_portal_design_ops')!({
      ops: [{ op: 'block.remove', block: 0 }],
      expected_revision: 'old',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Read it again')
  })

  it('are refused while the portal still uses the legacy theme', async () => {
    state.engine = 'legacy'
    const tools = collect(['settings.branding'])
    for (const name of ['get_portal_design', 'update_portal_design_draft']) {
      const result = await tools.get(name)!({ patch: {}, expected_revision: 'rev2' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('new portal design')
    }
    expect(state.patches).toEqual([])
  })
})
