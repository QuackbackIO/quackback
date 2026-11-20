/**
 * API keys on the non-support resources: personal and workspace key
 * management through the server functions, each key kind's authority, scope
 * coverage, the error envelope, pagination, import mode, rate limits and the
 * api.write audit. Journeys API-K-02, 03, 05..09, 11..13, 15, 17, 19, 21, 23,
 * 24, 25 (part), 27..29, 32..38.
 *
 * Every key is made per test; every request context has its own client
 * address (API-K-29 uses one address only it sends from). Teammates whose role
 * or keys change are made by the test.
 *
 * Not here: API-K-18 and API-K-22 are owner questions; API-K-25's webhook
 * subscription to support events is an owner question; API-K-20 needs a seat
 * cap (a plan-limits fixture the isolated job has no helper for).
 */
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb, pollFor } from '../../support/db'
import {
  apiFor,
  clientIp,
  createKey,
  eventsFor,
  expectJson,
  fixture,
  mcpOAuthToken,
  mcpRpc,
  newTeammate as customTeammate,
  type Wire,
} from '../../support/api-client'
import { callServerFn, personApi } from '../../support/server-fns'
import { sink } from '../../support/webhook-sink-client'
import { mintCustomer } from '../../support/widget-portal'
import {
  SECURITY_HEADERS,
  UNAUTHORIZED_MESSAGE,
  auditRows,
  customRoleKey,
  expectForbidden,
  identify,
  keyApi,
  keyRow,
  makeBoard,
  makePost,
  principalRole,
  roleIdOf,
  seedSegment,
  sessionApi,
} from '../../product/api-rest-keys'

test.describe.configure({ timeout: 60_000 })

const ALL_SCOPES = [
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:article',
  'write:article',
  'read:chat',
  'write:chat',
  'read:settings',
  'write:settings',
]
const DAY = 24 * 60 * 60 * 1000

interface Refusal {
  ok: false
  code: string
  message: string
}

/** The owner-role workspace key (legacy role admin) the admin person makes. */
function ownerKey(
  playwright: Parameters<typeof keyApi>[0],
  baseURL: string | undefined,
  email: string,
  extra: Record<string, string> = {}
) {
  return keyApi(
    playwright,
    baseURL,
    { creatorEmail: email, kind: 'workspace', roleKey: 'owner' },
    extra
  )
}

/** Expect `fn` returned a refusal value with `code`. */
function expectRefusal(res: { ok: boolean; data: unknown; raw: string }, code: string): Refusal {
  expect(res.ok, res.raw).toBe(true)
  const refusal = res.data as Refusal
  expect(refusal.ok, JSON.stringify(refusal)).toBe(false)
  expect(refusal.code).toBe(code)
  return refusal
}

test.describe('Personal keys', () => {
  test(
    'API-K-02 personal key expiry choices store 30, 90, 365 days or none; an unknown choice writes nothing',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'contributor' })
      const session = await sessionApi(playwright, mate.userId)
      for (const [expiry, days] of [
        ['30d', 30],
        ['90d', 90],
        ['1y', 365],
        ['never', null],
      ] as const) {
        const before = Date.now()
        const res = await callServerFn<Wire>(session, 'createMyApiKeyFn', {
          name: `${marker} ${expiry}`,
          scopes: ['read:feedback'],
          expiry,
        })
        expect(res.ok, res.raw).toBe(true)
        expect(res.data.ok).toBe(true)
        const row = await keyRow(res.data.apiKey.id)
        if (days === null) expect(row.expires_at).toBeNull()
        else {
          const at = new Date(row.expires_at).getTime()
          expect(at).toBeGreaterThanOrEqual(before + days * DAY - 5_000)
          expect(at).toBeLessThanOrEqual(Date.now() + days * DAY + 5_000)
        }
      }
      const bad = await callServerFn(session, 'createMyApiKeyFn', {
        name: `${marker} 2d`,
        scopes: ['read:feedback'],
        expiry: '2d',
      })
      expect(bad.ok).toBe(false)
      const [count] = await supportDb()`SELECT count(*)::int AS n FROM api_keys
                                        WHERE name = ${`${marker} 2d`}`
      expect(count.n).toBe(0)
      await session.dispose()
    }
  )

  test(
    'API-K-03 an expired personal key is refused, stays listed, and cannot be rotated',
    { tag: '@core' },
    async ({ playwright, baseURL, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'contributor' })
      const created = createKey({ creatorEmail: mate.email, scopes: ['read:feedback'] })
      const api = await apiFor(playwright, baseURL, created.key)
      await expectJson(await api.get('/api/v1/posts?limit=1'), 200)
      fixture({ op: 'expire', keyId: created.id })
      const body = await expectJson(await api.get('/api/v1/posts?limit=1'), 401)
      expect(body.error).toEqual({ code: 'UNAUTHORIZED', message: UNAUTHORIZED_MESSAGE })

      const session = await sessionApi(playwright, mate.userId)
      const list = await callServerFn<Wire>(session, 'fetchMyApiKeysFn', undefined, {
        method: 'GET',
      })
      expect(list.ok, list.raw).toBe(true)
      expect(list.data.keys.map((k: Wire) => k.id)).toContain(created.id)
      const rotate = await callServerFn(session, 'rotateMyApiKeyFn', { id: created.id })
      expect(expectRefusal(rotate, 'NOT_FOUND').message).toBe(
        'API key not found or already revoked'
      )
      await api.dispose()
      await session.dispose()
    }
  )

  test(
    'API-K-05 a teammate without api_key.manage cannot switch the personal key policy',
    { tag: '@nightly' },
    async ({ playwright, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager' })
      const session = await sessionApi(playwright, mate.userId)
      const before = await supportDb()`SELECT developer_config FROM settings LIMIT 1`
      const res = await callServerFn(session, 'setPersonalKeyPolicyFn', { enabled: false })
      expect(res.ok).toBe(false)
      expect(res.raw).toContain('api_key.manage')
      const after = await supportDb()`SELECT developer_config FROM settings LIMIT 1`
      expect(after[0].developer_config).toEqual(before[0].developer_config)
      // The key manager's own list says the policy is on.
      const admin = await personApi(playwright, 'admin')
      const keys = await callServerFn<Wire>(admin, 'fetchApiKeys', undefined, { method: 'GET' })
      expect(keys.data.personalKeysEnabled).toBe(true)
      await session.dispose()
      await admin.dispose()
    }
  )

  test(
    'API-K-06 a portal user has no personal keys',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const customer = await mintCustomer({ email: `${marker}@customers.example` })
      const session = await sessionApi(playwright, customer.userId)
      const list = await callServerFn(session, 'fetchMyApiKeysFn', undefined, { method: 'GET' })
      expect(list.ok).toBe(false)
      expect(list.raw).toContain('Access denied: Not a team member')
      const create = await callServerFn(session, 'createMyApiKeyFn', {
        name: marker,
        scopes: ['read:feedback'],
        expiry: '30d',
      })
      expect(create.ok).toBe(false)
      expect(create.raw).toContain('Access denied: Not a team member')
      const [count] = await supportDb()`SELECT count(*)::int AS n FROM api_keys
                                        WHERE created_by_id = ${customer.principalUuid}`
      expect(count.n).toBe(0)
      const page = await session.get('/settings/api-keys', { maxRedirects: 0 })
      expect(page.status()).toBeGreaterThanOrEqual(300)
      expect(page.status()).toBeLessThan(400)
      expect(page.headers()['location']).toContain('/settings/profile')
      await session.dispose()
    }
  )

  test(
    'API-K-07 rotating a personal key keeps the row and swaps the secret',
    { tag: '@core' },
    async ({ playwright, baseURL, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'contributor' })
      const session = await sessionApi(playwright, mate.userId)
      const made = await callServerFn<Wire>(session, 'createMyApiKeyFn', {
        name: marker,
        scopes: ['read:feedback', 'write:feedback'],
        expiry: '30d',
      })
      expect(made.data.ok, made.raw).toBe(true)
      const id = made.data.apiKey.id
      const oldApi = await apiFor(playwright, baseURL, made.data.plainTextKey)
      await expectJson(await oldApi.get('/api/v1/boards'), 200)
      await pollFor('last used', async () => ((await keyRow(id)).last_used_at ? true : null))
      const before = await keyRow(id)

      const rotated = await callServerFn<Wire>(session, 'rotateMyApiKeyFn', { id })
      expect(rotated.data.ok, rotated.raw).toBe(true)
      expect(rotated.data.plainTextKey).toMatch(/^qb_[0-9a-f]{48}$/)
      expect(rotated.data.plainTextKey).not.toBe(made.data.plainTextKey)
      const after = await keyRow(id)
      expect(after).toMatchObject({
        name: before.name,
        kind: 'personal',
        scopes: before.scopes,
        last_used_at: null,
      })
      expect(after.expires_at).toEqual(before.expires_at)
      expect(after.key_prefix).not.toBe(before.key_prefix)

      const dead = await expectJson(await oldApi.get('/api/v1/boards'), 401)
      expect(dead.error.message).toBe(UNAUTHORIZED_MESSAGE)
      const newApi = await apiFor(playwright, baseURL, rotated.data.plainTextKey)
      await expectJson(await newApi.get('/api/v1/boards'), 200)
      for (const c of [session, oldApi, newApi]) await c.dispose()
    }
  )

  test(
    'API-K-08 rename and revoke a personal key',
    { tag: '@nightly' },
    async ({ playwright, baseURL, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'contributor' })
      const session = await sessionApi(playwright, mate.userId)
      const created = createKey({ creatorEmail: mate.email, scopes: ['read:feedback'] })
      const renamed = await callServerFn<Wire>(session, 'renameMyApiKeyFn', {
        id: created.id,
        name: `Renamed ${marker}`,
      })
      expect(renamed.data.ok, renamed.raw).toBe(true)
      expect(await keyRow(created.id)).toMatchObject({
        name: `Renamed ${marker}`,
        display_name: `Renamed ${marker}`,
      })
      for (const name of ['', 'x'.repeat(256)]) {
        expect((await callServerFn(session, 'renameMyApiKeyFn', { id: created.id, name })).ok).toBe(
          false
        )
      }

      const api = await apiFor(playwright, baseURL, created.key)
      await expectJson(await api.get('/api/v1/boards'), 200)
      const revoked = await callServerFn<Wire>(session, 'revokeMyApiKeyFn', { id: created.id })
      expect(revoked.data.ok, revoked.raw).toBe(true)
      expect(await principalRole(created.principalId)).toBe('user')
      await expectJson(await api.get('/api/v1/boards'), 401)
      const list = await callServerFn<Wire>(session, 'fetchMyApiKeysFn', undefined, {
        method: 'GET',
      })
      expect(list.data.keys.map((k: Wire) => k.id)).not.toContain(created.id)
      expect((await eventsFor(created.id, ['apikey.deleted'])).length).toBe(1)
      const again = await callServerFn(session, 'revokeMyApiKeyFn', { id: created.id })
      expect(expectRefusal(again, 'NOT_FOUND').message).toBe('API key not found or already revoked')
      await api.dispose()
      await session.dispose()
    }
  )

  test(
    "API-K-09 another teammate's key or a workspace key is not found on the personal page",
    { tag: '@core' },
    async ({ playwright, baseURL, people, newTeammate }) => {
      const a = await newTeammate({ roleKey: 'contributor' })
      const b = await newTeammate({ roleKey: 'contributor' })
      const bKey = createKey({ creatorEmail: b.email, scopes: ['read:feedback'] })
      const wKey = createKey({
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        scopes: ['read:feedback'],
      })
      const session = await sessionApi(playwright, a.userId)
      for (const key of [bKey, wKey]) {
        const name = (await keyRow(key.id)).name
        expectRefusal(
          await callServerFn(session, 'renameMyApiKeyFn', { id: key.id, name: 'Hijacked' }),
          'NOT_FOUND'
        )
        expectRefusal(await callServerFn(session, 'rotateMyApiKeyFn', { id: key.id }), 'NOT_FOUND')
        expectRefusal(await callServerFn(session, 'revokeMyApiKeyFn', { id: key.id }), 'NOT_FOUND')
        expect(await keyRow(key.id)).toMatchObject({ name, revoked_at: null })
        const api = await apiFor(playwright, baseURL, key.key)
        await expectJson(await api.get('/api/v1/boards'), 200)
        await api.dispose()
      }
      const list = await callServerFn<Wire>(session, 'fetchMyApiKeysFn', undefined, {
        method: 'GET',
      })
      const listed = list.data.keys.map((k: Wire) => k.id)
      expect(listed).not.toContain(bKey.id)
      expect(listed).not.toContain(wKey.id)
      // A's own key is managed: the positive control.
      const own = createKey({ creatorEmail: a.email, scopes: ['read:feedback'] })
      const ok = await callServerFn<Wire>(session, 'renameMyApiKeyFn', { id: own.id, name: 'Mine' })
      expect(ok.data.ok, ok.raw).toBe(true)
      await session.dispose()
    }
  )
})

test.describe('Workspace keys', () => {
  test(
    'API-K-11 a key manager cannot create a workspace key above their own permissions or as Owner',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const managerName = `Key manager ${marker}`
      const mgr = customTeammate(managerName, ['api_key.manage', 'member.view', 'post.create'])
      const smallName = `Small ${marker}`
      customTeammate(smallName, ['member.view'])
      const session = await sessionApi(playwright, mgr.userId)
      for (const role of ['manager', 'owner']) {
        const name = `${marker} ${role}`
        const res = await callServerFn(session, 'createApiKeyFn', {
          name,
          roleId: await roleIdOf(role),
          scopes: ['read:feedback'],
        })
        expectRefusal(res, 'GRANT_CEILING')
        const [count] =
          await supportDb()`SELECT count(*)::int AS n FROM api_keys WHERE name = ${name}`
        expect(count.n).toBe(0)
        const [principals] = await supportDb()`SELECT count(*)::int AS n FROM principal
                                               WHERE display_name = ${name}`
        expect(principals.n).toBe(0)
      }
      const ok = await callServerFn<Wire>(session, 'createApiKeyFn', {
        name: `${marker} small`,
        roleId: await roleIdOf(customRoleKey(smallName)),
        scopes: ['read:feedback'],
      })
      expect(ok.data.ok, ok.raw).toBe(true)
      await session.dispose()
    }
  )

  test(
    'API-K-12 a custom-role manager cannot change an Owner-role key but can revoke any key',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const mgr = customTeammate(`Revoker ${marker}`, ['api_key.manage', 'member.view'])
      const session = await sessionApi(playwright, mgr.userId)
      const owner = createKey({
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
        scopes: ['read:feedback'],
      })
      expectRefusal(
        await callServerFn(session, 'updateApiKeyFn', { id: owner.id, name: 'Renamed' }),
        'GRANT_CEILING'
      )
      expectRefusal(
        await callServerFn(session, 'rotateApiKeyFn', { id: owner.id }),
        'GRANT_CEILING'
      )
      expectRefusal(
        await callServerFn(session, 'setWorkspaceKeyRoleFn', {
          id: owner.id,
          roleId: await roleIdOf('contributor'),
        }),
        'GRANT_CEILING'
      )
      const ownerApi = await apiFor(playwright, baseURL, owner.key)
      await expectJson(await ownerApi.get('/api/v1/boards'), 200)

      const mate = await newTeammate({ roleKey: 'contributor' })
      const personal = createKey({ creatorEmail: mate.email, scopes: ['read:feedback'] })
      expectRefusal(
        await callServerFn(session, 'updateApiKeyFn', { id: personal.id, name: 'Renamed' }),
        'NOT_FOUND'
      )
      expectRefusal(await callServerFn(session, 'rotateApiKeyFn', { id: personal.id }), 'NOT_FOUND')
      const personalApi = await apiFor(playwright, baseURL, personal.key)
      await expectJson(await personalApi.get('/api/v1/boards'), 200)

      for (const id of [owner.id, personal.id]) {
        const res = await callServerFn<Wire>(session, 'revokeApiKeyFn', { id })
        expect(res.data.ok, res.raw).toBe(true)
      }
      await expectJson(await ownerApi.get('/api/v1/boards'), 401)
      await expectJson(await personalApi.get('/api/v1/boards'), 401)
      for (const c of [session, ownerApi, personalApi]) await c.dispose()
    }
  )

  test(
    "API-K-13 changing a workspace key's role applies on the next request and is recorded",
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const key = await ownerKey(playwright, baseURL, people.people.admin.email)
      await expectJson(
        await key.api.post('/api/v1/boards', { data: { name: `Board one ${marker}` } }),
        201
      )
      const admin = await personApi(playwright, 'admin')
      const changed = await callServerFn<Wire>(admin, 'setWorkspaceKeyRoleFn', {
        id: key.id,
        roleId: await roleIdOf('contributor'),
      })
      expect(changed.data.ok, changed.raw).toBe(true)
      await expectForbidden(
        await key.api.post('/api/v1/boards', { data: { name: `Board two ${marker}` } }),
        "Requires the 'board.manage' permission"
      )
      const [updated] = await eventsFor(key.id, ['apikey.updated'])
      expect(updated.payload).toMatchObject({ changedKeys: ['role'], roleName: 'Contributor' })

      fixture({ op: 'revoke', keyId: key.id })
      const revoked = await callServerFn(admin, 'setWorkspaceKeyRoleFn', {
        id: key.id,
        roleId: await roleIdOf('owner'),
      })
      expect(expectRefusal(revoked, 'NOT_FOUND').message).toBe('Workspace key not found')
      expect(await principalRole(key.principalId)).toBe('user')
      await key.api.dispose()
      await admin.dispose()
    }
  )

  test(
    'API-K-15 a workspace key created without scopes is a NULL-scope legacy key',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const res = await callServerFn<Wire>(admin, 'createApiKeyFn', {
        name: `Legacy ${marker}`,
        roleId: await roleIdOf('contributor'),
      })
      expect(res.data.ok, res.raw).toBe(true)
      const id = res.data.apiKey.id
      try {
        expect((await keyRow(id)).scopes).toBeNull()
        const list = await callServerFn<Wire>(admin, 'fetchApiKeys', undefined, { method: 'GET' })
        const listed = list.data.keys.find((k: Wire) => k.id === id)
        expect(listed.scopes).toBeNull()
      } finally {
        await callServerFn(admin, 'revokeApiKeyFn', { id })
        await admin.dispose()
      }
    }
  )
})

test.describe('Key authority on feedback routes', () => {
  test(
    "API-K-17 a Contributor's personal key creates posts but cannot delete posts or manage tags",
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      const board = await makeBoard(owner.api, marker)
      const mate = await newTeammate({ roleKey: 'contributor' })
      const key = await keyApi(playwright, baseURL, {
        creatorEmail: mate.email,
        scopes: ALL_SCOPES,
      })
      const postId = await makePost(key.api, board, `Post ${marker}`)
      await expectForbidden(
        await key.api.delete(`/api/v1/posts/${postId}`),
        "Requires the 'post.delete' permission"
      )
      await expectForbidden(
        await key.api.post('/api/v1/tags', { data: { name: `Tag ${marker}`.slice(0, 50) } }),
        "Requires the 'tag.manage' permission"
      )
      const [post] = await supportDb()`SELECT deleted_at FROM posts
                                       WHERE id = ${toUuid(postId as `post_${string}`)}`
      expect(post.deleted_at).toBeNull()
      const [tags] = await supportDb()`SELECT count(*)::int AS n FROM post_tags
                                       WHERE name = ${`Tag ${marker}`.slice(0, 50)}`
      expect(tags.n).toBe(0)
      // The owner key deletes the same post.
      expect((await owner.api.delete(`/api/v1/posts/${postId}`)).status()).toBe(204)
      await key.api.dispose()
      await owner.api.dispose()
    }
  )

  test(
    'API-K-19 demoting the creator narrows their personal key at once',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      const mate = await newTeammate({ roleKey: 'admin' })
      const key = await keyApi(playwright, baseURL, {
        creatorEmail: mate.email,
        scopes: ALL_SCOPES,
      })
      const hook = await expectJson(
        await key.api.post('/api/v1/webhooks', {
          data: { url: sink.url(marker), events: ['post.created'] },
        }),
        201
      )
      try {
        await expectJson(
          await owner.api.patch(`/api/v1/principals/${mate.principalId}`, {
            data: { role: 'member', roleId: await roleIdOf('manager') },
          }),
          200
        )
        await expectForbidden(
          await key.api.post('/api/v1/webhooks', {
            data: { url: sink.url(marker), events: ['post.created'] },
          }),
          "Requires the 'webhook.manage' permission"
        )
        expect((await keyRow(key.id)).revoked_at).toBeNull()
        await expectJson(await key.api.get('/api/v1/boards'), 200)
      } finally {
        await owner.api.delete(`/api/v1/webhooks/${hook.data.id}`)
        await key.api.dispose()
        await owner.api.dispose()
      }
    }
  )

  test(
    'API-K-21 a workspace key outlives its creator within its role; their personal keys are revoked',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      const board = await makeBoard(owner.api, marker)
      const mate = await newTeammate({ roleKey: 'admin' })
      const workspace = await keyApi(playwright, baseURL, {
        creatorEmail: mate.email,
        kind: 'workspace',
        roleKey: 'contributor',
      })
      const personal = createKey({ creatorEmail: mate.email })
      expect((await owner.api.delete(`/api/v1/principals/${mate.principalId}`)).status()).toBe(204)

      expect((await keyRow(personal.id)).revoked_at).not.toBeNull()
      expect(await principalRole(personal.principalId)).toBe('user')
      await makePost(workspace.api, board, `Post ${marker}`)
      await expectJson(await workspace.api.get('/api/v1/users?limit=1'), 200)
      await expectForbidden(
        await workspace.api.post('/api/v1/boards', { data: { name: `Nope ${marker}` } }),
        "Requires the 'board.manage' permission"
      )
      await workspace.api.dispose()
      await owner.api.dispose()
    }
  )
})

test.describe('Scopes on the non-support resources', () => {
  test(
    'API-K-23 a read-only feedback key is refused feedback writes and writes nothing',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      const board = await makeBoard(owner.api, marker)
      const postId = await makePost(owner.api, board, `Post ${marker}`)
      const reader = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:feedback'],
      })
      await expectJson(await reader.api.get('/api/v1/posts?limit=1'), 200)
      await expectForbidden(
        await reader.api.post('/api/v1/posts', { data: { boardId: board, title: `No ${marker}` } }),
        "This API key is missing the 'write:feedback' scope required by 'post.create'"
      )
      await expectForbidden(
        await reader.api.post(`/api/v1/posts/${postId}/vote`),
        "This API key is missing the 'write:feedback' scope required by 'post.vote_on_behalf'"
      )
      const [posts] = await supportDb()`SELECT count(*)::int AS n FROM posts
                                        WHERE board_id = ${toUuid(board as `board_${string}`)}`
      expect(posts.n).toBe(1)
      // No vote row for the reader key's principal.
      const [votes] = await supportDb()`SELECT count(*)::int AS n FROM post_votes
        WHERE post_id = ${toUuid(postId as `post_${string}`)}
          AND principal_id = ${toUuid(reader.principalId as `principal_${string}`)}`
      expect(votes.n).toBe(0)
      await reader.api.dispose()
      await owner.api.dispose()
    }
  )

  test(
    'API-K-24 a chat-only key: refused on gated feedback reads, allowed on bare ones',
    { tag: '@core' },
    async ({ playwright, baseURL, people }) => {
      const chat = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:chat', 'write:chat'],
      })
      for (const [path, permission] of [
        ['/api/v1/posts', 'post.view_private'],
        ['/api/v1/users', 'people.view'],
        ['/api/v1/changelog', 'changelog.view_draft'],
      ]) {
        await expectForbidden(
          await chat.api.get(path),
          `This API key is missing the 'read:feedback' scope required by '${permission}'`
        )
      }
      for (const path of [
        '/api/v1/boards',
        '/api/v1/tags',
        '/api/v1/statuses',
        '/api/v1/roadmaps',
        '/api/v1/help-center/articles',
        '/api/v1/status/summary',
      ]) {
        const res = await chat.api.get(path)
        expect(res.status(), `${path}: ${await res.text()}`).toBe(200)
      }
      await chat.api.dispose()
    }
  )

  test(
    'API-K-25 a Feedback-only workspace key reaches people, companies and status, not settings',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const key = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
        scopes: ['read:feedback', 'write:feedback'],
      })
      await expectJson(await key.api.get('/api/v1/users?limit=1'), 200)
      await expectJson(await key.api.get('/api/v1/companies?limit=1'), 200)
      await identify(key.api, `${marker}@customers.example`)
      const service = await expectJson(
        await key.api.post('/api/v1/status/services', { data: { name: `Service ${marker}` } }),
        201
      )
      expect(service.data.name).toBe(`Service ${marker}`)
      await expectForbidden(
        await key.api.patch('/api/v1/settings/branding', { data: {} }),
        "This API key is missing the 'write:settings' scope"
      )
      await key.api.dispose()
    }
  )

  test(
    'API-K-27 REST takes only qb_ keys; the Bearer scheme is case-insensitive',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const token = mcpOAuthToken(people.people.admin.email, ['read:feedback'])
      const oauth = await apiFor(playwright, baseURL, token)
      const res = await oauth.get('/api/v1/posts?limit=1')
      const body = await expectJson(res, 401)
      expect(body.error).toEqual({ code: 'UNAUTHORIZED', message: UNAUTHORIZED_MESSAGE })
      expect(res.headers()['www-authenticate']).toBe('Bearer realm="Quackback API"')
      const { key } = createKey({ creatorEmail: people.people.admin.email })
      const lower = await apiFor(playwright, baseURL, null, { authorization: `bearer   ${key}` })
      await expectJson(await lower.get('/api/v1/posts?limit=1'), 200)
      await oauth.dispose()
      await lower.dispose()
    }
  )

  test(
    'API-K-28 a key records its last use, even on a refused call',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const key = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:chat'],
      })
      expect((await keyRow(key.id)).last_used_at).toBeNull()
      await expectJson(await key.api.get('/api/v1/posts?limit=1'), 403)
      await pollFor('last_used_at', async () => ((await keyRow(key.id)).last_used_at ? true : null))
      const admin = await personApi(playwright, 'admin')
      const list = await callServerFn<Wire>(admin, 'fetchApiKeys', undefined, { method: 'GET' })
      expect(list.data.keys.find((k: Wire) => k.id === key.id).lastUsedAt).toBeTruthy()
      await key.api.dispose()
      await admin.dispose()
    }
  )
})

test.describe('Rate limits and import mode', () => {
  test(
    'API-K-29 the 101st call a minute from one address is 429, REST, MCP and bad keys combined',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const ip = clientIp()
      const { key } = createKey({ creatorEmail: people.people.admin.email })
      const api = await apiFor(playwright, baseURL, key, { 'x-e2e-client-ip': ip })
      const bad = await apiFor(playwright, baseURL, `qb_${'0'.repeat(48)}`, {
        'x-e2e-client-ip': ip,
      })
      for (let i = 0; i < 50; i++) expect((await api.get('/api/v1/boards')).status()).toBe(200)
      for (let i = 0; i < 40; i++) expect((await mcpRpc(api, 'tools/list')).status()).toBe(200)
      for (let i = 0; i < 10; i++) expect((await bad.get('/api/v1/boards')).status()).toBe(401)
      const limited = await api.get('/api/v1/boards')
      const body = await expectJson(limited, 429)
      expect(body.error).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      })
      expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0)
      expect((await mcpRpc(api, 'tools/list')).status()).toBe(429)
      // Another address is not limited.
      const other = await apiFor(playwright, baseURL, key)
      await expectJson(await other.get('/api/v1/boards'), 200)
      for (const c of [api, bad, other]) await c.dispose()
    }
  )

  test(
    'API-K-32 import mode on an owner key skips delivery and is one rollup; a Contributor key is not',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      test.setTimeout(90_000)
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email, {
        'x-import-mode': 'true',
      })
      const board = await makeBoard(owner.api, marker)
      const hook = await expectJson(
        await owner.api.post('/api/v1/webhooks', {
          data: { url: sink.url(marker), events: ['post.created'], boardIds: [board] },
        }),
        201
      )
      try {
        const imported: string[] = []
        for (const n of [1, 2, 3])
          imported.push(await makePost(owner.api, board, `Imp ${n} ${marker}`))
        const contributor = await keyApi(
          playwright,
          baseURL,
          { creatorEmail: people.people.admin.email, kind: 'workspace', roleKey: 'contributor' },
          { 'x-import-mode': 'true' }
        )
        const normal = await makePost(contributor.api, board, `Normal ${marker}`)
        // The Contributor post is delivered; once it lands, none of the imported ones has.
        await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(normal),
          timeoutMs: 20_000,
        })
        const all = await sink.waitForDeliveries(marker, { count: 1, timeoutMs: 3_000 })
        for (const id of imported) expect(all.some((d) => d.body.includes(id))).toBe(false)

        const rollups = await supportDb()`SELECT event_type, event_outcome FROM audit_log
          WHERE event_type = 'api.import' AND credential_id = ${owner.id}`
        expect(rollups).toEqual([{ event_type: 'api.import', event_outcome: 'success' }])
        for (const id of imported) expect(await auditRows('api.write', id)).toEqual([])
        const written = await pollFor('api.write for the normal post', async () => {
          const rows = await auditRows('api.write', normal)
          return rows.length ? rows : null
        })
        expect(written[0]).toMatchObject({
          credential_id: contributor.id,
          event_outcome: 'success',
        })
        await contributor.api.dispose()
      } finally {
        await owner.api.delete(`/api/v1/webhooks/${hook.data.id}`)
        await owner.api.dispose()
      }
    }
  )
})

test.describe('Error envelope, pagination and repeats', () => {
  test(
    'API-K-33 the error envelope on the non-support routes, with the security headers',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      const check = async (res: Awaited<ReturnType<typeof owner.api.get>>, status: number) => {
        const body = await expectJson(res, status)
        for (const [h, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers()[h]).toBe(v)
        expect(body.error.requestId).toBeUndefined()
        return body.error
      }
      const empty = await check(await owner.api.post('/api/v1/boards', { data: {} }), 400)
      expect(empty).toMatchObject({ code: 'BAD_REQUEST', message: 'Invalid request body' })
      expect(Object.keys(empty.details.errors)).toEqual(['name'])
      expect(await check(await owner.api.get('/api/v1/boards/post_123'), 400)).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid board ID format',
      })
      for (const [path, prefix, message] of [
        ['boards', 'board', 'Board not found'],
        ['posts', 'post', 'Post not found'],
        ['statuses', 'post_status', 'Status not found'],
        ['roadmaps', 'roadmap', 'Roadmap not found'],
        ['help-center/articles', 'kb_article', 'Help center article not found'],
        ['changelog', 'changelog', 'Changelog entry not found'],
      ] as const) {
        const id = generateId(prefix as Parameters<typeof generateId>[0])
        expect(await check(await owner.api.get(`/api/v1/${path}/${id}`), 404), path).toEqual({
          code: 'NOT_FOUND',
          message,
        })
      }
      const slug = `k33-${marker}`.slice(0, 90)
      const first = await expectJson(
        await owner.api.post('/api/v1/boards', { data: { name: `A ${marker}`, slug } }),
        201
      )
      const second = await expectJson(
        await owner.api.post('/api/v1/boards', { data: { name: `B ${marker}`, slug } }),
        201
      )
      expect(first.data.slug).toBe(slug)
      expect(second.data.slug).not.toBe(slug)
      expect(
        await check(
          await owner.api.patch(`/api/v1/boards/${second.data.id}`, { data: { slug } }),
          409
        )
      ).toEqual({ code: 'CONFLICT', message: `A board with slug "${slug}" already exists` })
      await owner.api.dispose()
    }
  )

  test(
    'API-K-34 cursor pages on posts, users and companies never overlap and end with hasMore false',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      const board = await makeBoard(owner.api, marker)
      const posts: string[] = []
      const users: string[] = []
      for (const n of [1, 2, 3, 4, 5]) {
        posts.push(await makePost(owner.api, board, `Page ${n} ${marker}`))
        users.push((await identify(owner.api, `${marker}-${n}@customers.example`)).principalId)
      }
      const companies: string[] = []
      for (const n of [1, 2, 3]) {
        const id = generateId('company')
        await supportDb()`INSERT INTO companies (id, name, source)
                          VALUES (${toUuid(id)}, ${`Co ${n} ${marker}`}, 'api')`
        companies.push(id)
      }
      const walk = async (base: string, field: string) => {
        const seen: string[] = []
        let cursor: string | null = null
        for (let i = 0; i < 10; i++) {
          const url: string = `${base}&limit=2${cursor ? `&cursor=${cursor}` : ''}`
          const body = await expectJson(await owner.api.get(url), 200)
          expect(body.data.length).toBeLessThanOrEqual(2)
          seen.push(...body.data.map((r: Wire) => r[field]))
          if (!body.meta.pagination.hasMore) {
            expect(body.meta.pagination.cursor).toBeNull()
            return seen
          }
          cursor = body.meta.pagination.cursor
        }
        throw new Error(`${base} never ended`)
      }
      const postIds = await walk(
        `/api/v1/posts?search=${encodeURIComponent(marker)}&boardId=${board}`,
        'id'
      )
      expect(postIds.sort()).toEqual([...posts].sort())
      const userIds = await walk(`/api/v1/users?search=${marker}`, 'principalId')
      expect(userIds.sort()).toEqual([...users].sort())
      const companyIds = await walk(`/api/v1/companies?search=${marker}`, 'id')
      expect(companyIds.sort()).toEqual([...companies].sort())

      // A garbage users cursor restarts at the first page.
      const page1 = await expectJson(
        await owner.api.get(`/api/v1/users?search=${marker}&limit=2`),
        200
      )
      const garbage = await expectJson(
        await owner.api.get(`/api/v1/users?search=${marker}&limit=2&cursor=garbage`),
        200
      )
      expect(garbage.data.map((u: Wire) => u.principalId)).toEqual(
        page1.data.map((u: Wire) => u.principalId)
      )
      // Lists without paging answer a plain array.
      const boards = await expectJson(await owner.api.get('/api/v1/boards'), 200)
      expect(Array.isArray(boards.data)).toBe(true)
      expect(boards.meta).toBeUndefined()
      await owner.api.dispose()
    }
  )

  test(
    'API-K-34 a garbage cursor never answers 500',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'posts, changelog, status incidents and help center articles pass an undecodable cursor to their service, which throws: 500 (routes/api/v1/posts/index.ts:48, changelog/index.ts, status/incidents/index.ts, help-center/articles/index.ts:75)',
      },
    },
    async ({ playwright, baseURL, people }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      for (const path of ['posts', 'changelog', 'status/incidents', 'help-center/articles']) {
        const res = await owner.api.get(`/api/v1/${path}?cursor=garbage&limit=2`)
        expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(500)
      }
      await owner.api.dispose()
    }
  )

  test(
    'API-K-35 a users cursor replayed with a different limit continues where it stopped',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'The users route turns the offset cursor into a page number, so a different limit repeats or skips rows (routes/api/v1/users/index.ts:47-48)',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      for (const n of [1, 2, 3, 4, 5, 6]) {
        await identify(owner.api, `${marker}-${n}@customers.example`, { name: `${marker} ${n}` })
      }
      const all = await expectJson(
        await owner.api.get(`/api/v1/users?search=${marker}&sort=name&limit=6`),
        200
      )
      const order = all.data.map((u: Wire) => u.principalId)
      const first = await expectJson(
        await owner.api.get(`/api/v1/users?search=${marker}&sort=name&limit=2`),
        200
      )
      const next = await expectJson(
        await owner.api.get(
          `/api/v1/users?search=${marker}&sort=name&limit=3&cursor=${first.meta.pagination.cursor}`
        ),
        200
      )
      expect(next.data.map((u: Wire) => u.principalId)).toEqual(order.slice(2, 5))
      await owner.api.dispose()
    }
  )

  test(
    'API-K-36 there is no idempotency key: a repeated create makes a duplicate',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email, {
        'idempotency-key': marker,
      })
      const board = await makeBoard(owner.api, marker)
      const a = await makePost(owner.api, board, `Same ${marker}`)
      const b = await makePost(owner.api, board, `Same ${marker}`)
      expect(a).not.toBe(b)
      const hooks: string[] = []
      try {
        for (let i = 0; i < 2; i++) {
          const hook = await expectJson(
            await owner.api.post('/api/v1/webhooks', {
              data: { url: sink.url(marker), events: ['post.created'] },
            }),
            201
          )
          hooks.push(hook.data.id)
        }
        expect(new Set(hooks).size).toBe(2)
      } finally {
        for (const id of hooks) await owner.api.delete(`/api/v1/webhooks/${id}`)
        await owner.api.dispose()
      }
    }
  )

  test(
    'API-K-37 api.write rows for non-support writes: route patterns, created id, refusals',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const owner = await ownerKey(playwright, baseURL, people.people.admin.email)
      const board = await makeBoard(owner.api, marker)
      const postId = await makePost(owner.api, board, `Audited ${marker}`)
      const seg = await seedSegment(marker)
      const user = await identify(owner.api, `${marker}@customers.example`)
      await expectJson(
        await owner.api.post(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [user.principalId] },
        }),
        200
      )
      const contributor = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'contributor',
      })
      await expectJson(await contributor.api.delete(`/api/v1/boards/${board}`), 403)
      const anonIp = clientIp()
      const anon = await apiFor(playwright, baseURL, null, { 'x-e2e-client-ip': anonIp })
      await expectJson(await anon.post('/api/v1/tags', { data: { name: 'x' } }), 401)

      const created = await pollFor('api.write for the post', async () => {
        const rows = await auditRows('api.write', postId)
        return rows.length ? rows : null
      })
      expect(created[0]).toMatchObject({
        event_outcome: 'success',
        channel: 'api',
        credential_id: owner.id,
        metadata: { method: 'POST', route: '/api/v1/posts', status: 201 },
      })
      const segRows = await supportDb()`SELECT metadata FROM audit_log
        WHERE event_type = 'api.write' AND credential_id = ${owner.id}
          AND metadata->>'route' LIKE '/api/v1/segments/%'`
      expect(segRows.map((r) => r.metadata.route)).toEqual(['/api/v1/segments/:param/members'])
      const refused = await pollFor('api.write for the refused delete', async () => {
        const rows = await auditRows('api.write', board)
        const failed = rows.filter((r) => r.event_outcome === 'failure')
        return failed.length ? failed : null
      })
      expect(refused[0]).toMatchObject({
        credential_id: contributor.id,
        metadata: {
          method: 'DELETE',
          route: '/api/v1/boards/:id',
          status: 403,
          errorCode: 'FORBIDDEN',
        },
      })
      const [anonRows] = await supportDb()`SELECT count(*)::int AS n FROM audit_log
        WHERE event_type = 'api.write' AND actor_ip = ${anonIp}`
      expect(anonRows.n).toBe(0)
      // No row holds a key or the body.
      const [leaks] = await supportDb()`SELECT count(*)::int AS n FROM audit_log
        WHERE event_type = 'api.write' AND credential_id = ${owner.id}
          AND (metadata::text LIKE '%qb_%' OR metadata::text LIKE ${`%Audited ${marker}%`})`
      expect(leaks.n).toBe(0)
      for (const c of [owner.api, contributor.api, anon]) await c.dispose()
    }
  )

  test(
    'API-K-38 a workspace key on a webhook-managing custom role lists and creates webhooks',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const roleName = `Hooks ${marker}`
      customTeammate(roleName, ['webhook.view', 'webhook.manage'])
      const key = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: customRoleKey(roleName),
      })
      await expectJson(await key.api.get('/api/v1/webhooks'), 200)
      const hook = await expectJson(
        await key.api.post('/api/v1/webhooks', {
          data: { url: sink.url(marker), events: ['post.created'] },
        }),
        201
      )
      await key.api.delete(`/api/v1/webhooks/${hook.data.id}`)
      // Without webhook.manage the same kind of key is refused.
      await expectForbidden(
        await key.api.post('/api/v1/boards', { data: { name: marker } }),
        "Requires the 'board.manage' permission"
      )
      await key.api.dispose()
    }
  )
})
