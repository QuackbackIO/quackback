/**
 * A failed MCP client scope reconcile never blocks sign-in, and is retried in
 * the background until it succeeds.
 *
 * Building a workspace's auth instance widens every stored OAuth client scope
 * list to the MCP scope catalogue. When that update fails, the instance is still
 * built and served, one warning is logged, and the workspace is marked as having
 * the reconcile pending. A later request that is served the cached instance
 * starts the reconcile again in the background (at most once a minute, one at a
 * time) without waiting for it and without rebuilding the instance.
 *
 * Real auth server, real Postgres, rolled back after each test.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { sql, type SQL } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { oauthAccessToken, oauthClient, oauthResource, session, user } from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { API_KEY_SCOPES, MCP_AS_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'

// An origin of its own: building auth upserts the MCP resource row for the
// base URL, and this suite holds its transaction across waits, so sharing the
// row with the other auth suites would make them wait on, or deadlock with, it.
vi.hoisted(() => {
  process.env.BASE_URL = 'http://localhost:3197'
  process.env.SECRET_KEY = 'test-secret-key-for-reconcile-retry-0123456789'
})

// The auth hooks read the request's headers; there is no server request here.
const request = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => request.headers,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

/**
 * The real reconcile, run against a database that refuses the update while
 * `failing` is set. Each call is recorded, and a test can hold one open.
 */
const control = vi.hoisted(() => ({
  failing: false,
  calls: 0,
  warns: 0,
  hold: null as Promise<void> | null,
}))
vi.mock('../reconcile-mcp-oauth-client-scopes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../reconcile-mcp-oauth-client-scopes')>()
  return {
    reconcileMcpOauthClientScopes: async (opts: {
      db: { execute: (query: SQL) => Promise<unknown> }
    }) => {
      control.calls += 1
      if (control.hold) await control.hold
      const db = control.failing
        ? {
            execute: async () => {
              throw new Error('connection reset')
            },
          }
        : opts.db
      return real.reconcileMcpOauthClientScopes({
        ...opts,
        db,
        log: { warn: () => void (control.warns += 1) },
      })
    },
  }
})

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ scopes: oauthClient.scopes }).from(oauthClient).limit(0)
  },
})

const ORIGIN = 'http://localhost:3197'

/** A client registered before the settings scopes joined the catalogue. */
const OLDER_CLIENT_SCOPES = MCP_AS_SCOPES.filter((s) => !s.endsWith(':settings'))

async function seedOlderClient(): Promise<string> {
  const clientId = `client-${createId('app')}`
  await testDb.insert(oauthClient).values({
    id: createId('app'),
    clientId,
    redirectUris: ['http://127.0.0.1:4000/callback'],
    scopes: [...OLDER_CLIENT_SCOPES],
  })
  return clientId
}

async function scopesOf(clientId: string): Promise<string[] | null> {
  const rows = (await testDb.execute(
    sql`select scopes from oauth_client where client_id = ${clientId}`
  )) as unknown as Array<{ scopes: string[] | null }>
  return rows[0]?.scopes ?? null
}

async function signedInHeaders(): Promise<Headers> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({
    id: userId,
    name: 'Dana Admin',
    email: `dana-${Math.random().toString(36).slice(2, 8)}@example.com`,
    emailVerified: true,
  })
  const token = `tok-${Math.random().toString(36).slice(2, 12)}`
  await testDb.insert(session).values({
    id: `sess-${token}`,
    token,
    userId,
    scope: 'dashboard',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    updatedAt: new Date(),
  })
  return new Headers({ authorization: `Bearer ${token}` })
}

/** Ask the authorize endpoint, as a signed-in person, for `scope` on behalf of `clientId`. */
async function authorize(
  auth: { handler: (request: Request) => Promise<Response> },
  clientId: string,
  scope: string,
  headers: Headers
): Promise<{ status: number; location: string; body: string }> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: 'http://127.0.0.1:4000/callback',
    scope,
    state: 'state-1',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    resource: `${ORIGIN}/api/mcp`,
  })
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/authorize?${params}`, { headers })
  )
  return {
    status: res.status,
    location: res.headers.get('location') ?? '',
    body: await res.text(),
  }
}

describe.skipIf(!fixture.available)('MCP client scope reconcile retry (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    await ensureMcpOauthResource({
      db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
      table: oauthResource,
      identifier: `${ORIGIN}/api/mcp`,
      allowedScopes: API_KEY_SCOPES,
    })
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    control.failing = false
    control.calls = 0
    control.warns = 0
    control.hold = null
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('serves sign-in after a failed reconcile and adds the scopes on a later request', async () => {
    const { getAuth } = await import('@/lib/server/auth/index')
    const clientId = await seedOlderClient()

    control.failing = true
    const auth = await getAuth()
    expect(control.calls).toBe(1)
    expect(control.warns).toBe(1)
    expect(await scopesOf(clientId)).not.toContain('read:settings')

    // Sign-in still works on the instance built after the failure.
    const headers = await signedInHeaders()
    request.headers = headers
    const signedIn = await auth.api.getSession({ headers })
    expect(signedIn?.user?.email).toMatch(/@example\.com$/)

    // Within the minute, a request does not try again.
    expect(await getAuth()).toBe(auth)
    expect(control.calls).toBe(1)

    // A minute on, the next requests start one background reconcile between
    // them, are answered before it finishes, and get the same instance.
    control.failing = false
    let release!: () => void
    control.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const later = Date.now() + 61_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    const served = await Promise.all([getAuth(), getAuth(), getAuth()])
    expect(served.every((instance) => instance === auth)).toBe(true)
    expect(control.calls).toBe(2)
    expect(await scopesOf(clientId)).not.toContain('read:settings')

    // An attempt still running a minute later is not joined by a second one.
    vi.spyOn(Date, 'now').mockReturnValue(later + 61_000)
    expect(await getAuth()).toBe(auth)
    expect(control.calls).toBe(2)

    release()
    await vi.waitFor(async () => expect(await scopesOf(clientId)).toContain('read:settings'), {
      timeout: 10_000,
    })
    for (const scope of MCP_AS_SCOPES) expect(await scopesOf(clientId)).toContain(scope)

    // Done: no further attempt, however late the next request.
    vi.spyOn(Date, 'now').mockReturnValue(later + 10 * 61_000)
    expect(await getAuth()).toBe(auth)
    expect(control.calls).toBe(2)
  })

  it('lets a client registered before the settings scopes authorize them once reconciled', async () => {
    const { getAuth } = await import('@/lib/server/auth/index')
    const clientId = await seedOlderClient()
    control.failing = true
    const auth = await getAuth()
    const headers = await signedInHeaders()
    request.headers = headers

    // The failed reconcile left the stored list short, so authorize refuses.
    const before = await authorize(auth, clientId, 'openid read:settings', headers)
    expect(before.location).toContain('error=invalid_scope')

    // A token issued earlier keeps exactly the scopes it was granted.
    const tokenId = createId('app')
    await testDb.insert(oauthAccessToken).values({
      id: tokenId,
      token: `at-${tokenId}`,
      clientId,
      scopes: ['openid', 'read:feedback'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
    })

    control.failing = false
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    expect(await getAuth()).toBe(auth)
    await vi.waitFor(async () => expect(await scopesOf(clientId)).toContain('read:settings'), {
      timeout: 10_000,
    })

    const after = await authorize(auth, clientId, 'openid read:settings', headers)
    expect(after.location).not.toContain('error=')
    expect(after.status).toBeLessThan(400)
    const token = (await testDb.execute(
      sql`select scopes from oauth_access_token where id = ${tokenId}`
    )) as unknown as Array<{ scopes: string[] }>
    expect(token[0].scopes).toEqual(['openid', 'read:feedback'])
  })

  it('keeps retrying while the reconcile keeps failing', async () => {
    const { getAuth } = await import('@/lib/server/auth/index')
    await seedOlderClient()
    control.failing = true
    const auth = await getAuth()

    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start + 61_000)
    expect(await getAuth()).toBe(auth)
    await vi.waitFor(() => expect(control.warns).toBe(2), { timeout: 10_000 })

    vi.spyOn(Date, 'now').mockReturnValue(start + 2 * 61_000 + 1_000)
    expect(await getAuth()).toBe(auth)
    await vi.waitFor(() => expect(control.warns).toBe(3), { timeout: 10_000 })
    expect(control.calls).toBe(3)
  })

  it('does not mark anything pending when the reconcile succeeds', async () => {
    const { getAuth } = await import('@/lib/server/auth/index')
    const clientId = await seedOlderClient()
    const auth = await getAuth()
    expect(await scopesOf(clientId)).toContain('read:settings')

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    expect(await getAuth()).toBe(auth)
    expect(control.calls).toBe(1)
    expect(control.warns).toBe(0)
  })
})
