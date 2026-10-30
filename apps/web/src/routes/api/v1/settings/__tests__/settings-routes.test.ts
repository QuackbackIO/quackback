/**
 * The settings routes' wire behaviour: the status each outcome maps to, the
 * If-Match rules and the scope gate. The registry itself is covered by its
 * contract test against Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LockedError, PreconditionFailedError } from '@/lib/shared/errors'

const state = vi.hoisted(() => ({
  scopes: null as string[] | null,
  calls: [] as unknown[],
  result: null as unknown,
  error: null as Error | null,
  undo: { status: 'undone', result: { id: 'audit_1', undone: true } } as unknown,
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: async () => ({
    apiKey: { id: 'api_key_1', name: 'CI', scopes: state.scopes, createdById: 'principal_owner' },
    principalId: 'principal_key',
    role: 'admin',
    permissions: new Set(['settings.manage']),
  }),
}))
vi.mock('@/lib/server/domains/settings-registry/service', () => ({
  changeSettingsArea: async (caller: unknown, area: string, input: unknown) => {
    state.calls.push({ caller, area, input })
    if (state.error) throw state.error
    return state.result
  },
  readSettingsArea: async (_actor: unknown, area: string) => ({ id: area, revision: 'rev1' }),
  listSettingsAreas: async () => [],
}))
vi.mock('@/lib/server/domains/settings-registry/undo', () => ({
  undoSettingsReceipt: async (caller: unknown, id: string) => {
    state.calls.push({ undo: id, caller })
    return state.undo
  },
}))

import { Route as AreaRoute } from '../$area'
import { Route as UndoRoute } from '../receipts.$receiptId.undo'

type Handlers = Record<
  string,
  (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>
>
const area = (AreaRoute.options.server as { handlers: Handlers }).handlers
const undo = (UndoRoute.options.server as { handlers: Handlers }).handlers

const patch = (headers: Record<string, string> = {}, query = '') =>
  area.PATCH({
    request: new Request(`http://localhost/api/v1/settings/messenger${query}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ enabled: true }),
    }),
    params: { area: 'messenger' },
  })

beforeEach(() => {
  state.scopes = null
  state.calls = []
  state.error = null
  state.result = { status: 'noop', revision: 'rev1' }
  state.undo = { status: 'undone', result: { id: 'audit_1', undone: true } }
})

describe('the caller the routes build', () => {
  it("acts as the key's creator with exactly the key's permissions", async () => {
    await patch({ 'if-match': 'rev1' })
    const { caller } = state.calls[0] as {
      caller: { actor: { principalId: string; permissions: Set<string> } }
    }
    expect(caller.actor.principalId).toBe('principal_owner')
    expect([...caller.actor.permissions]).toEqual(['settings.manage'])
  })
})

describe('PATCH /settings/:area', () => {
  it('answers 428 without If-Match and calls nothing', async () => {
    const response = await patch()
    expect(response.status).toBe(428)
    expect((await response.json()).error.code).toBe('IF_MATCH_REQUIRED')
    expect(state.calls).toEqual([])
  })

  it('passes If-Match to the registry and answers 200 with the ETag when applied', async () => {
    state.result = {
      status: 'applied',
      receipt: { id: 'audit_1', revision: 'rev2', changes: [] },
    }
    const response = await patch({ 'if-match': '"rev1"' })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"rev2"')
    expect((await response.json()).data).toMatchObject({ status: 'applied' })
    expect(state.calls).toMatchObject([
      {
        area: 'messenger',
        input: { patch: { enabled: true }, expectedRevision: '"rev1"', dryRun: false },
      },
    ])
  })

  it('previews with dry_run and no If-Match', async () => {
    state.result = { status: 'dry_run', preview: { revision: 'rev1', changes: [] } }
    const response = await patch({}, '?dry_run=true')
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ status: 'dry_run' })
    expect(state.calls).toMatchObject([{ input: { dryRun: true } }])
  })

  it('maps a stale revision to 412 and a locked field to 423', async () => {
    state.error = new PreconditionFailedError('REVISION_MISMATCH', 'stale', { revision: 'rev9' })
    const stale = await patch({ 'if-match': 'rev1' })
    expect(stale.status).toBe(412)
    expect((await stale.json()).error).toMatchObject({
      code: 'REVISION_MISMATCH',
      details: { revision: 'rev9' },
    })
    state.error = new LockedError('FIELD_LOCKED', 'locked')
    const locked = await patch({ 'if-match': 'rev1' })
    expect(locked.status).toBe(423)
    expect((await locked.json()).error.code).toBe('FIELD_LOCKED')
  })

  it('refuses a key without the write:settings scope', async () => {
    state.scopes = ['read:settings']
    expect((await patch({ 'if-match': 'rev1' })).status).toBe(403)
    expect(state.calls).toEqual([])
  })

  it('rejects a body that is not an object', async () => {
    const response = await area.PATCH({
      request: new Request('http://localhost/api/v1/settings/messenger', {
        method: 'PATCH',
        headers: { 'if-match': 'rev1' },
        body: '[1]',
      }),
      params: { area: 'messenger' },
    })
    expect(response.status).toBe(400)
  })
})

describe('GET /settings/:area', () => {
  it('returns the revision as the ETag, and a read-only key may read', async () => {
    state.scopes = ['read:settings']
    const response = await area.GET({
      request: new Request('http://localhost/api/v1/settings/messenger'),
      params: { area: 'messenger' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"rev1"')
  })
})

describe('POST /settings/receipts/:id/undo', () => {
  it('undoes with the write scope and refuses without it', async () => {
    const request = () => new Request('http://localhost/x', { method: 'POST' })
    expect((await undo.POST({ request: request(), params: { receiptId: 'audit_1' } })).status).toBe(
      200
    )
    state.scopes = ['read:settings']
    expect((await undo.POST({ request: request(), params: { receiptId: 'audit_1' } })).status).toBe(
      403
    )
  })
})
