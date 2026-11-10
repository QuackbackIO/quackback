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
  calls: [] as unknown[],
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
  patchDesignDraft: async (patch: unknown, author: unknown, expected: unknown) => {
    state.calls.push({ patch, author, expected })
    return state.patchResult
  },
  discardDesignDraft: async () => {
    state.calls.push('discard')
    return { ok: true }
  },
  listDesignVersions: async () => [],
}))

import { Route as DesignRoute } from '../portal_design'
import { Route as DraftRoute } from '../portal_design.draft'

type Handlers = Record<string, (ctx: { request: Request }) => Promise<Response>>
const design = (DesignRoute.options.server as { handlers: Handlers }).handlers
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
  state.calls = []
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
})

describe('DELETE /api/v1/settings/portal_design/draft', () => {
  it('discards the draft', async () => {
    const response = await draft.DELETE({
      request: new Request('http://localhost/api/v1/settings/portal_design/draft', {
        method: 'DELETE',
      }),
    })
    expect(response.status).toBe(204)
    expect(state.calls).toEqual(['discard'])
  })
})
