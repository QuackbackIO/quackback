/**
 * The portal design MCP tools: a person with the branding permission reads
 * the design and edits its draft; a stale revision and a broken design come
 * back as errors the client can act on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const state = vi.hoisted(() => ({
  patchResult: { ok: true } as unknown,
  patches: [] as unknown[],
}))

vi.mock('../../resolve-actor', () => ({
  resolveMcpActor: async () => ({ principalId: 'principal_member', role: 'member' }),
}))
vi.mock('@/lib/server/domains/design/design.actions', () => ({
  readDesignForEditing: async () => ({ design: {}, source: 'draft', revision: 'rev2' }),
  patchDesignDraft: async (patch: unknown, author: unknown, expected: unknown) => {
    state.patches.push({ patch, author, expected })
    return state.patchResult
  },
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
  state.patchResult = { ok: true }
  state.patches = []
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
    const update = tools.find((tool) => tool.name === 'update_portal_design_draft')!
    const examples = update.description.split('\n').filter((line) => line.startsWith('{"'))
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) z.object(update.schema).parse(JSON.parse(example))
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
})
