/**
 * The portal design routes' wire behaviour: the scope and permission gates,
 * the If-Match rule, the ETag, and the status each refusal maps to. The
 * actions themselves are covered against Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  scopes: null as string[] | null,
  permissions: new Set(['settings.branding']),
  patchResult: { ok: true } as unknown,
  discardResult: { ok: true } as unknown,
  calls: [] as unknown[],
  opsResult: { ok: true, applied: [0], refused: [], revision: 'rev2' } as unknown,
}))

vi.mock('@/lib/server/domains/api/auth', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/api/auth')>()),
  withApiKeyAuth: async () => ({
    apiKey: { id: 'api_key_1', name: 'CI', scopes: state.scopes, createdById: 'principal_owner' },
    principalId: 'principal_key',
    role: 'admin',
    permissions: state.permissions,
  }),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({
      from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [] }) }) }),
    }),
  },
}))
vi.mock('@/lib/server/domains/design/design.actions', () => ({
  readDesignForEditing: async () => ({ design: {}, source: 'converted', revision: 'rev1' }),
  patchDesignDraft: async (
    patch: unknown,
    author: unknown,
    expected: unknown,
    options: unknown
  ) => {
    state.calls.push({ patch, author, expected, options })
    return state.patchResult
  },
  discardDesignDraft: async (expected: unknown) => {
    state.calls.push({ discard: expected })
    return state.discardResult
  },
  listDesignVersions: async () => [],
}))

vi.mock('@/lib/server/domains/design/draft-ops', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/design/draft-ops')>()),
  applyDraftOps: async (ops: unknown, author: unknown, expected: unknown, gates: unknown) => {
    state.calls.push({ ops, author, expected, gates })
    return state.opsResult
  },
}))
vi.mock('@/lib/server/domains/design/workspace-gates', () => ({
  workspaceGates: async () => ({ feedback: true }),
}))

import { Route as DesignRoute } from '../portal_design'
import { Route as OpsRoute } from '../portal_design.draft.ops'
import { Route as DraftRoute } from '../portal_design.draft'

type Handlers = Record<string, (ctx: { request: Request }) => Promise<Response>>
const design = (DesignRoute.options.server as { handlers: Handlers }).handlers
const ops = (OpsRoute.options.server as { handlers: Handlers }).handlers
const draft = (DraftRoute.options.server as { handlers: Handlers }).handlers

const patch = (headers: Record<string, string> = {}) =>
  design.PATCH({
    request: new Request('http://localhost/api/v1/settings/portal_design', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ layout: { density: 'compact' } }),
    }),
  })

beforeEach(() => {
  state.scopes = null
  state.permissions = new Set(['settings.branding'])
  state.patchResult = { ok: true }
  state.discardResult = { ok: true }
  state.calls = []
  state.opsResult = { ok: true, applied: [0], refused: [], revision: 'rev2' }
})

describe('GET /api/v1/settings/portal_design', () => {
  it('returns the design with its revision as the ETag', async () => {
    const response = await design.GET({
      request: new Request('http://localhost/api/v1/settings/portal_design'),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"rev1"')
  })

  it('needs the branding permission', async () => {
    state.permissions = new Set(['settings.manage'])
    const response = await design.GET({
      request: new Request('http://localhost/api/v1/settings/portal_design'),
    })
    expect(response.status).toBe(403)
  })
})

describe('PATCH /api/v1/settings/portal_design', () => {
  it('needs If-Match', async () => {
    expect((await patch()).status).toBe(428)
    expect(state.calls).toEqual([])
  })

  it('passes the revision it was sent, unquoted, for the owner of the key', async () => {
    const response = await patch({ 'if-match': '"rev1"' })
    expect(response.status).toBe(200)
    expect(state.calls[0]).toMatchObject({
      patch: { layout: { density: 'compact' } },
      author: { principalId: 'principal_owner' },
      expected: 'rev1',
    })
  })

  it('answers 412 for a stale revision and 400 for a broken design', async () => {
    state.patchResult = { ok: false, code: 'REVISION_MISMATCH', message: 'stale' }
    expect((await patch({ 'if-match': '"old"' })).status).toBe(412)
    state.patchResult = { ok: false, code: 'UNREADABLE_DESIGN', message: 'ink' }
    const response = await patch({ 'if-match': '"rev1"' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'UNREADABLE_DESIGN' } })
  })

  it('needs the write scope', async () => {
    state.scopes = ['read:settings']
    expect((await patch({ 'if-match': '"rev1"' })).status).toBe(403)
  })

  it('passes replace only when the query asks for it', async () => {
    await patch({ 'if-match': '"rev1"' })
    const replaced = await design.PATCH({
      request: new Request('http://localhost/api/v1/settings/portal_design?replace=true', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'if-match': '"rev1"' },
        body: JSON.stringify({ overrides: [] }),
      }),
    })
    expect(replaced.status).toBe(200)
    expect(state.calls).toMatchObject([
      { options: { replace: false } },
      { options: { replace: true } },
    ])
  })

  it('answers 400 for an array patch without replace', async () => {
    state.patchResult = { ok: false, code: 'REPLACE_REQUIRED', message: 'replace' }
    const response = await patch({ 'if-match': '"rev1"' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'REPLACE_REQUIRED' } })
  })
})

describe('POST /api/v1/settings/portal_design/draft/ops', () => {
  const post = (body: unknown, headers: Record<string, string> = { 'if-match': '"rev1"' }) =>
    ops.POST({
      request: new Request('http://localhost/api/v1/settings/portal_design/draft/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    })
  const one = { ops: [{ op: 'block.remove', block: 'ideas001' }] }

  it('needs If-Match', async () => {
    expect((await post(one, {})).status).toBe(428)
    expect(state.calls).toEqual([])
  })

  it('applies the ops against the revision, with the workspace pages, and returns what happened', async () => {
    state.opsResult = {
      ok: true,
      applied: [0],
      refused: [{ index: 1, reason: 'That block is no longer on Home' }],
      revision: 'rev2',
    }
    const response = await post(one)
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"rev2"')
    expect(await response.json()).toMatchObject({
      data: {
        applied: [0],
        refused: [{ index: 1, reason: 'That block is no longer on Home' }],
        revision: 'rev2',
      },
    })
    expect(state.calls[0]).toMatchObject({
      ops: one.ops,
      author: { principalId: 'principal_owner' },
      expected: 'rev1',
      gates: { feedback: true },
    })
  })

  it('refuses ops it does not know, and the builder\'s drag state', async () => {
    expect((await post({ ops: [{ op: 'design.publish' }] })).status).toBe(400)
    expect((await post({ ops: [] })).status).toBe(400)
    expect(
      (await post({ ops: [{ op: 'block.drop', block: {}, at: null, gates: {} }] })).status
    ).toBe(400)
    expect(state.calls).toEqual([])
  })

  it('answers 412 for a stale revision and needs the write scope', async () => {
    state.opsResult = { ok: false, code: 'REVISION_MISMATCH', message: 'stale' }
    expect((await post(one)).status).toBe(412)
    state.scopes = ['read:settings']
    expect((await post(one)).status).toBe(403)
  })
})

describe('DELETE /api/v1/settings/portal_design/draft', () => {
  it('discards the draft', async () => {
    const response = await draft.DELETE({
      request: new Request('http://localhost/api/v1/settings/portal_design/draft', {
        method: 'DELETE',
      }),
    })
    expect(response.status).toBe(204)
    expect(state.calls).toEqual([{ discard: undefined }])
  })

  it('passes If-Match through as the revision the discard is made against', async () => {
    const response = await draft.DELETE({
      request: new Request('http://localhost/api/v1/settings/portal_design/draft', {
        method: 'DELETE',
        headers: { 'if-match': 'W/"rev1"' },
      }),
    })
    expect(response.status).toBe(204)
    expect(state.calls).toEqual([{ discard: 'rev1' }])
  })

  it('refuses a stale If-Match with 412', async () => {
    state.discardResult = {
      ok: false,
      code: 'REVISION_MISMATCH',
      message: 'The draft changed since you opened it.',
    }
    const response = await draft.DELETE({
      request: new Request('http://localhost/api/v1/settings/portal_design/draft', {
        method: 'DELETE',
        headers: { 'if-match': '"rev0"' },
      }),
    })
    expect(response.status).toBe(412)
  })
})
