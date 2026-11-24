/**
 * Client ID Metadata Documents (CIMD) on the real auth server and real
 * Postgres, rolled back after each test.
 *
 * An MCP client uses an HTTPS URL as its client_id. The server fetches the
 * document there (through a stand-in transport: the real one refuses loopback,
 * see cimd-transport.test.ts), creates a client row owned by the `cimd`
 * discovery, and runs the ordinary authorization-code flow. The suite pins the
 * discovery metadata at every URL the app serves, the client row's scopes and
 * resource, the consent identity, the token the MCP endpoint accepts, and the
 * documents the plugin refuses.
 */
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { eq } from 'drizzle-orm'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  auditLog,
  oauthClient,
  oauthConsent,
  oauthClientResource,
  oauthResource,
  principal,
  session,
  settings,
  user,
} from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { reconcileMcpOauthClientScopes } from '@/lib/server/auth/reconcile-mcp-oauth-client-scopes'
import { API_KEY_SCOPES, MCP_AS_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'
// Static imports: these module graphs are heavy, and loading them inside a
// test body would spend its timeout on the transform.
import { handleMcpRequest } from '@/lib/server/mcp/handler'
import * as authServerMetadataRoute from '@/routes/[.]well-known.oauth-authorization-server'
import * as authServerMetadataPathRoute from '@/routes/[.]well-known.oauth-authorization-server.api.auth'
import * as openIdConfigRoute from '@/routes/[.]well-known.openid-configuration'
import * as openIdConfigPathRoute from '@/routes/[.]well-known.openid-configuration.api.auth'
import * as authCatchAllRoute from '@/routes/api/auth/$'

// An origin of its own: building auth upserts the MCP resource row for the
// base URL, and each test holds a transaction on it.
vi.hoisted(() => {
  process.env.BASE_URL = 'http://localhost:3198'
  process.env.SECRET_KEY = 'test-secret-key-for-cimd-flow-0123456789abcdef'
})

const request = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => request.headers,
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

/** The documents the stand-in transport serves, by URL. */
const docs = vi.hoisted(() => ({
  served: new Map<string, () => Response>(),
  fetches: [] as string[],
}))
vi.mock('@better-auth/cimd/node', () => ({
  fetchClientMetadataResource: async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    docs.fetches.push(url)
    const respond = docs.served.get(url)
    if (!respond) throw new TypeError('fetch failed')
    return respond()
  },
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: oauthClient.id, discovery: oauthClient.clientDiscoveryId })
      .from(oauthClient)
      .limit(0)
  },
})

const ORIGIN = 'http://localhost:3198'
const CLIENT_ID = 'https://chat.example.com/oauth/client-metadata.json'
const REDIRECT_URI = 'https://chat.example.com/oauth/callback'
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWEFEjXk'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')

function serveJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  docs.served.set(url, () =>
    Response.json(body, { headers: { 'cache-control': 'max-age=3600', ...headers } })
  )
}

function serveDocument(overrides: Record<string, unknown> = {}) {
  serveJson(CLIENT_ID, {
    client_id: CLIENT_ID,
    client_name: 'Chat Example',
    client_uri: 'https://chat.example.com',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...overrides,
  })
}

/** A file route's server GET handler, as the server calls it. */
function routeGet(mod: { Route: { options: unknown } }) {
  return (
    mod.Route.options as {
      server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } }
    }
  ).server.handlers.GET
}

function routePost(mod: { Route: { options: unknown } }) {
  return (
    mod.Route.options as {
      server: { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } }
    }
  ).server.handlers.POST
}

async function getAuth() {
  const { getAuth } = await import('@/lib/server/auth/index')
  return getAuth()
}

async function signedIn(): Promise<{ userId: UserId; headers: Headers }> {
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
  return { userId, headers: new Headers({ authorization: `Bearer ${token}`, origin: ORIGIN }) }
}

/**
 * Ask the authorize endpoint through the app's route, as a client does: the
 * route widens `scope` to the whole catalogue first, so this also proves the
 * client row allows every scope.
 */
async function authorize(headers: Headers, overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid offline_access read:feedback',
    state: 'state-1',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: `${ORIGIN}/api/mcp`,
    ...overrides,
  })
  const res = await routeGet(authCatchAllRoute)({
    request: new Request(`${ORIGIN}/api/auth/oauth2/authorize?${params}`, { headers }),
  })
  return { status: res.status, location: res.headers.get('location') ?? '', body: await res.text() }
}

/** Accept on the consent screen, then exchange the code through the route. */
async function consentAndExchange(headers: Headers, consentLocation: string) {
  // Consent, as the consent page posts it.
  const consentQuery = new URL(consentLocation, ORIGIN).search.replace(/^\?/, '')
  const auth = await getAuth()
  const consent = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        scope: 'openid offline_access read:feedback',
        oauth_query: consentQuery,
      }),
    })
  )
  const consentBody = (await consent.json()) as { url?: string; redirect?: boolean }
  expect(consent.status, JSON.stringify(consentBody)).toBe(200)
  const callback = new URL(consentBody.url!)
  expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI)
  const code = callback.searchParams.get('code')
  expect(code).toBeTruthy()

  // Through the route, which adds the MCP `resource` the client left out.
  const tokenRes = await routePost(authCatchAllRoute)({
    request: new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: VERIFIER,
      }).toString(),
    }),
  })
  const tokens = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    scope?: string
  }
  expect(tokenRes.status, JSON.stringify(tokens)).toBe(200)
  return tokens
}

/**
 * Set the workspace's "Dynamic client registration" switch the way a save
 * leaves it: stored, settings cache dropped, auth instance rebuilt.
 */
async function setRegistration(enabled: boolean) {
  const developerConfig = JSON.stringify({ oauthDynamicClientRegistrationEnabled: enabled })
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) {
    await testDb.update(settings).set({ developerConfig }).where(eq(settings.id, row.id))
  } else {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
      developerConfig,
    })
  }
  const { invalidateSettingsCache } = await import('@/lib/server/domains/settings/settings.helpers')
  await invalidateSettingsCache()
  const { resetAuth } = await import('@/lib/server/auth/index')
  resetAuth()
}

describe.skipIf(!fixture.available)('Client ID Metadata Documents (real DB, rolled back)', () => {
  beforeEach(async () => {
    await fixture.begin()
    await ensureMcpOauthResource({
      db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
      table: oauthResource,
      identifier: `${ORIGIN}/api/mcp`,
      allowedScopes: API_KEY_SCOPES,
    })
    // A fresh auth instance, so the plugin's document cache starts empty.
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    docs.served.clear()
    docs.fetches = []
    request.headers = new Headers()
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('advertises CIMD at every discovery URL the app serves', async () => {
    const routes = [
      ['/.well-known/oauth-authorization-server', authServerMetadataRoute],
      ['/.well-known/oauth-authorization-server/api/auth', authServerMetadataPathRoute],
      ['/.well-known/openid-configuration', openIdConfigRoute],
      ['/.well-known/openid-configuration/api/auth', openIdConfigPathRoute],
      ['/api/auth/.well-known/openid-configuration', authCatchAllRoute],
      ['/api/auth/.well-known/oauth-authorization-server', authCatchAllRoute],
    ] as const
    for (const [path, mod] of routes) {
      const res = await routeGet(mod)({ request: new Request(`${ORIGIN}${path}`) })
      expect(res.status, path).toBe(200)
      const meta = (await res.json()) as Record<string, unknown>
      expect(meta.client_id_metadata_document_supported, path).toBe(true)
      expect(meta.issuer, path).toBe(`${ORIGIN}/api/auth`)
    }
  })

  it('creates the client from its document and runs the code flow to a token /api/mcp accepts', async () => {
    serveDocument()
    const auth = await getAuth()
    const person = await signedIn()
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: 'acme',
      createdAt: new Date(),
    })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: person.userId,
      role: 'admin',
      type: 'user',
      createdAt: new Date(),
    })

    const first = await authorize(person.headers)
    expect(first.status, first.body).toBe(302)
    expect(first.location).toContain('/oauth/consent')
    expect(docs.fetches).toEqual([CLIENT_ID])

    // The row belongs to the discovery and carries the full MCP capability
    // set, so a later step-up can ask for writes.
    const [row] = await testDb.select().from(oauthClient).where(eq(oauthClient.clientId, CLIENT_ID))
    expect(row?.clientDiscoveryId).toBe('cimd')
    expect(row?.name).toBe('Chat Example')
    expect(row?.redirectUris).toEqual([REDIRECT_URI])
    expect(row?.clientSecret ?? null).toBeNull()
    expect([...(row?.scopes ?? [])].sort()).toEqual([...MCP_AS_SCOPES].sort())
    // Linked to the MCP resource, as a registered client is.
    const links = await testDb
      .select({ resourceId: oauthClientResource.resourceId })
      .from(oauthClientResource)
      .where(eq(oauthClientResource.clientId, CLIENT_ID))
    expect(links.map((l) => l.resourceId)).toEqual([`${ORIGIN}/api/mcp`])

    // Audited once, with the verified host.
    const audits = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'oauth.client.discovered'))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.targetId).toBe(CLIENT_ID)
    expect(audits[0]?.actorUserId).toBe(person.userId)
    expect((audits[0]?.metadata as { host?: string }).host).toBe('chat.example.com')

    // The consent screen's data says who is verified.
    const publicClient = await routeGet(authCatchAllRoute)({
      request: new Request(
        `${ORIGIN}/api/auth/oauth2/public-client?client_id=${encodeURIComponent(CLIENT_ID)}`,
        { headers: person.headers }
      ),
    })
    expect(publicClient.status).toBe(200)
    expect(await publicClient.json()).toMatchObject({
      client_id: CLIENT_ID,
      client_name: 'Chat Example',
      client_identity: { verified: true, host: 'chat.example.com' },
    })

    const tokens = await consentAndExchange(person.headers, first.location)
    const payload = JSON.parse(
      Buffer.from(tokens.access_token!.split('.')[1]!, 'base64url').toString()
    ) as { aud: string | string[]; azp?: string; scope?: string }
    expect([payload.aud].flat()).toContain(`${ORIGIN}/api/mcp`)
    expect(payload.azp).toBe(CLIENT_ID)
    expect(payload.scope?.split(' ')).toContain('read:feedback')

    // The MCP route verifies the signature against the server's own JWKS.
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return url.endsWith('/api/auth/jwks')
        ? auth.handler(new Request(url))
        : realFetch(input, init)
    })
    const mcpRes = await handleMcpRequest(
      new Request(`${ORIGIN}/api/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${tokens.access_token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
    )
    expect(mcpRes.status).toBe(200)
  })

  it('lets a CIMD client step up to write scopes, also after its document is refetched', async () => {
    serveDocument()
    const person = await signedIn()
    expect((await authorize(person.headers)).status).toBe(302)

    // A new instance has an empty cache: the next use refetches and refreshes
    // the row. A changed name is audited; the capability set is kept.
    serveDocument({ client_name: 'Chat Example Pro' })
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    const stepUp = await authorize(person.headers, { scope: MCP_AS_SCOPES.join(' ') })
    expect(stepUp.status, stepUp.body).toBe(302)
    expect(stepUp.location).toContain('/oauth/consent')
    expect(stepUp.location).not.toContain('error=')
    expect(docs.fetches).toEqual([CLIENT_ID, CLIENT_ID])

    const [row] = await testDb.select().from(oauthClient).where(eq(oauthClient.clientId, CLIENT_ID))
    expect(row?.name).toBe('Chat Example Pro')
    expect([...(row?.scopes ?? [])].sort()).toEqual([...MCP_AS_SCOPES].sort())
    const refreshed = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'oauth.client.refreshed'))
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]?.beforeValue).toMatchObject({ name: 'Chat Example' })
    expect(refreshed[0]?.afterValue).toMatchObject({ name: 'Chat Example Pro' })
  })

  it('widens a CIMD row with the scope reconcile, like any other client', async () => {
    serveDocument()
    const person = await signedIn()
    expect((await authorize(person.headers)).status).toBe(302)
    await testDb
      .update(oauthClient)
      .set({ scopes: ['openid', 'read:feedback'] })
      .where(eq(oauthClient.clientId, CLIENT_ID))
    expect(await reconcileMcpOauthClientScopes({ db: testDb })).toBe(true)
    const [row] = await testDb.select().from(oauthClient).where(eq(oauthClient.clientId, CLIENT_ID))
    expect([...(row?.scopes ?? [])].sort()).toEqual([...MCP_AS_SCOPES].sort())
  })

  it('marks a self-registered client as unverified and names its redirect host', async () => {
    const auth = await getAuth()
    const reg = await auth.handler(
      new Request(`${ORIGIN}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'ChatGPT',
          client_uri: 'https://chatgpt.com',
          redirect_uris: ['https://attacker.example/cb'],
          token_endpoint_auth_method: 'none',
        }),
      })
    )
    expect(reg.status).toBe(201)
    const { client_id } = (await reg.json()) as { client_id: string }
    const person = await signedIn()
    const res = await routeGet(authCatchAllRoute)({
      request: new Request(
        `${ORIGIN}/api/auth/oauth2/public-client?client_id=${client_id}&redirect_uri=${encodeURIComponent('https://attacker.example/cb')}`,
        { headers: person.headers }
      ),
    })
    expect(await res.json()).toMatchObject({
      client_name: 'ChatGPT',
      client_identity: { verified: false, redirect: { kind: 'web', host: 'attacker.example' } },
    })
  })

  // DCR stays for clients without CIMD. Better Auth 1.7.26 accepts a
  // host-bearing private-use redirect from a native client, but still treats
  // an omitted application_type as `web` and refuses it (better-auth#10946),
  // so the register interceptor in mcp-dcr-scopes.ts is still needed.
  it('still registers and authorizes a Cursor-style DCR client through the route', async () => {
    const cursorRedirect = 'cursor://anysphere.cursor-mcp/oauth/callback'
    const auth = await getAuth()
    const bare = await auth.handler(
      new Request(`${ORIGIN}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Cursor',
          redirect_uris: [cursorRedirect],
          token_endpoint_auth_method: 'none',
        }),
      })
    )
    expect(bare.status, 'Better Auth alone still refuses it').toBe(400)

    const reg = await routePost(authCatchAllRoute)({
      request: new Request(`${ORIGIN}/api/auth/oauth2/register`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Cursor',
          redirect_uris: [cursorRedirect],
          token_endpoint_auth_method: 'none',
        }),
      }),
    })
    const registered = (await reg.json()) as { client_id: string; redirect_uris: string[] }
    expect(reg.status, JSON.stringify(registered)).toBe(201)
    expect(registered.redirect_uris).toEqual([cursorRedirect])

    const person = await signedIn()
    const res = await authorize(person.headers, {
      client_id: registered.client_id,
      redirect_uri: cursorRedirect,
    })
    expect(res.status, res.body).toBe(302)
    expect(res.location).toContain('/oauth/consent')
  })

  describe('refuses a document the server should not trust', () => {
    async function refused(): Promise<string> {
      const person = await signedIn()
      const res = await authorize(person.headers)
      expect(res.status).toBeGreaterThanOrEqual(300)
      const rows = await testDb
        .select()
        .from(oauthClient)
        .where(eq(oauthClient.clientId, CLIENT_ID))
      expect(rows).toHaveLength(0)
      // Fetched once, then refused: the refusal is the plugin's, not an unknown client's.
      expect(docs.fetches).toEqual([CLIENT_ID])
      return `${res.location} ${res.body}`
    }

    it('one that names a different client_id', async () => {
      serveDocument({ client_id: 'https://evil.example/client.json' })
      expect(await refused()).toMatch(/does not match|invalid_client/)
    })

    it('one without redirect_uris (MCP 2026-07-28 profile)', async () => {
      serveDocument({ redirect_uris: undefined })
      expect(await refused()).toMatch(/redirect_uris|invalid_client/)
    })

    it('one without client_name (MCP 2026-07-28 profile)', async () => {
      serveDocument({ client_name: undefined })
      expect(await refused()).toMatch(/client_name|invalid_client/)
    })

    it('one that asks for a shared secret', async () => {
      serveDocument({ token_endpoint_auth_method: 'client_secret_basic' })
      expect(await refused()).toMatch(/invalid_client/)
    })

    it('one served as HTML', async () => {
      docs.served.set(
        CLIENT_ID,
        () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
      )
      expect(await refused()).toMatch(/invalid_client/)
    })

    it('one that is not JSON', async () => {
      docs.served.set(
        CLIENT_ID,
        () => new Response('{not json', { headers: { 'content-type': 'application/json' } })
      )
      expect(await refused()).toMatch(/invalid_client/)
    })

    it('one over the size limit', async () => {
      serveDocument({ padding: 'x'.repeat(10_000) })
      expect(await refused()).toMatch(/invalid_client/)
    })

    it('a redirect', async () => {
      docs.served.set(
        CLIENT_ID,
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example/client.json' },
          })
      )
      expect(await refused()).toMatch(/invalid_client/)
    })
  })

  // A workspace's auth instance (and so the document cache) is rebuilt after
  // the pool goes idle, so a cold instance refetches the document on first
  // use. A transient failure (the stand-in throws, as a network error does)
  // must not lock out a client people already connected (draft §6.1): the
  // recently validated stored row keeps working. A terminal failure still
  // fails closed.
  it('keeps a stored client working when a cold instance cannot reach its document', async () => {
    serveDocument()
    const person = await signedIn()
    expect((await authorize(person.headers)).status).toBe(302)

    docs.served.clear()
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    const res = await authorize(person.headers)
    expect(res.status, res.body).toBe(302)
    expect(res.location).toContain('/oauth/consent')
    expect(res.location).not.toContain('error=')
    expect(docs.fetches).toEqual([CLIENT_ID, CLIENT_ID])
    const rows = await testDb.select().from(oauthClient).where(eq(oauthClient.clientId, CLIENT_ID))
    expect(rows).toHaveLength(1)
  })

  it('refreshes a token on a cold instance that cannot reach the document', async () => {
    serveDocument()
    const person = await signedIn()
    const first = await authorize(person.headers)
    const tokens = await consentAndExchange(person.headers, first.location)
    expect(tokens.refresh_token).toBeTruthy()

    docs.served.clear()
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    const refresh = await routePost(authCatchAllRoute)({
      request: new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token!,
          client_id: CLIENT_ID,
        }).toString(),
      }),
    })
    const body = await refresh.text()
    expect(refresh.status, body).toBe(200)
    expect(JSON.parse(body).access_token).toBeTruthy()
    expect(docs.fetches).toEqual([CLIENT_ID, CLIENT_ID])
  })

  it('fails closed on a cold instance when the document is gone', async () => {
    serveDocument()
    const person = await signedIn()
    expect((await authorize(person.headers)).status).toBe(302)

    docs.served.set(CLIENT_ID, () => new Response('gone', { status: 404 }))
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    const res = await authorize(person.headers)
    expect(`${res.location} ${res.body}`).toMatch(/invalid_client/)
  })

  it('marks the stored client as validated again after each successful refetch', async () => {
    serveDocument()
    const person = await signedIn()
    expect((await authorize(person.headers)).status).toBe(302)
    const [before] = await testDb
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, CLIENT_ID))

    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    expect((await authorize(person.headers)).status).toBe(302)
    const [after] = await testDb
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, CLIENT_ID))
    // The stale limit for transient failures counts from this timestamp.
    expect(after!.updatedAt!.getTime()).toBeGreaterThan(before!.updatedAt!.getTime())
  })

  it('asks for consent again when a refetched document changes the redirect URIs', async () => {
    serveDocument()
    const person = await signedIn()
    const first = await authorize(person.headers)
    await consentAndExchange(person.headers, first.location)
    const stored = await testDb
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, CLIENT_ID))
    expect(stored.length).toBeGreaterThan(0)

    serveDocument({
      redirect_uris: [REDIRECT_URI, 'https://chat.example.com/oauth/new-callback'],
    })
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    expect((await authorize(person.headers)).status).toBe(302)

    const after = await testDb
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, CLIENT_ID))
    expect(after).toHaveLength(0)
    const [audit] = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'oauth.client.refreshed'))
    expect(audit?.metadata).toMatchObject({ consentCleared: true })
  })

  // Discovery runs before the sign-in check, as client lookup does for DCR
  // clients. Only the plugin's fetch budgets bound it; the DCR registration
  // limiter in the route does not apply.
  it('discovers the client on an authorize request from someone not signed in', async () => {
    serveDocument()
    const res = await authorize(new Headers({ origin: ORIGIN }))
    expect(res.status).toBe(302)
    expect(res.location).toContain('/auth/login')
    expect(docs.fetches).toEqual([CLIENT_ID])
    const audits = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'oauth.client.discovered'))
    expect(audits.map((a) => [a.actorType, a.actorUserId])).toEqual([['anonymous', null]])
  })

  it('never fetches a client_id outside the policy', async () => {
    const person = await signedIn()
    for (const clientId of [
      'https://chat.example.com/',
      'https://chat.example.com',
      'http://chat.example.com/oauth/client.json',
      'https://user:pass@chat.example.com/oauth/client.json',
      'https://127.0.0.1/oauth/client.json',
      'https://chat.example.com/a/../client.json',
      // This server's own host: a JSON file it serves must not pass as a client.
      'https://localhost/oauth/client.json',
    ]) {
      const res = await authorize(person.headers, { client_id: clientId })
      expect(res.status, clientId).toBeGreaterThanOrEqual(300)
    }
    expect(docs.fetches).toEqual([])
  })

  // The switch covers both ways a new app registers. Off: no new CIMD client,
  // no advertisement; a client that registered earlier keeps working, as a
  // DCR client does.
  describe('with dynamic client registration turned off', () => {
    const OTHER_CLIENT_ID = 'https://other.example.com/oauth/client-metadata.json'
    const OTHER_REDIRECT_URI = 'https://other.example.com/oauth/callback'

    // The rollback removes the row, not the cached "off" copy or the instance
    // built from it.
    afterEach(async () => {
      const { invalidateSettingsCache } =
        await import('@/lib/server/domains/settings/settings.helpers')
      await invalidateSettingsCache()
      const { resetAuth } = await import('@/lib/server/auth/index')
      resetAuth()
    })

    it('stops advertising CIMD at every discovery URL', async () => {
      await setRegistration(false)
      const routes = [
        ['/.well-known/oauth-authorization-server', authServerMetadataRoute],
        ['/.well-known/oauth-authorization-server/api/auth', authServerMetadataPathRoute],
        ['/.well-known/openid-configuration', openIdConfigRoute],
        ['/.well-known/openid-configuration/api/auth', openIdConfigPathRoute],
        ['/api/auth/.well-known/openid-configuration', authCatchAllRoute],
        ['/api/auth/.well-known/oauth-authorization-server', authCatchAllRoute],
      ] as const
      for (const [path, mod] of routes) {
        const res = await routeGet(mod)({ request: new Request(`${ORIGIN}${path}`) })
        expect(res.status, path).toBe(200)
        const meta = (await res.json()) as Record<string, unknown>
        expect(meta.client_id_metadata_document_supported, path).not.toBe(true)
        expect(meta.issuer, path).toBe(`${ORIGIN}/api/auth`)
      }
    })

    it('refuses a new client without fetching its document', async () => {
      serveDocument()
      await setRegistration(false)
      const person = await signedIn()
      const res = await authorize(person.headers)
      expect(res.status).toBeGreaterThanOrEqual(300)
      expect(`${res.location} ${res.body}`).toMatch(/access_denied/)
      expect(res.location.startsWith(REDIRECT_URI)).toBe(false)
      expect(docs.fetches).toEqual([])
      const rows = await testDb
        .select()
        .from(oauthClient)
        .where(eq(oauthClient.clientId, CLIENT_ID))
      expect(rows).toHaveLength(0)
    })

    it('keeps a client that registered while it was on, and refuses a new one', async () => {
      serveDocument()
      serveJson(OTHER_CLIENT_ID, {
        client_id: OTHER_CLIENT_ID,
        client_name: 'Other Example',
        redirect_uris: [OTHER_REDIRECT_URI],
        token_endpoint_auth_method: 'none',
      })
      await setRegistration(true)
      const person = await signedIn()
      expect((await authorize(person.headers)).status).toBe(302)

      await setRegistration(false)
      const kept = await authorize(person.headers)
      expect(kept.status, kept.body).toBe(302)
      expect(kept.location).toContain('/oauth/consent')
      expect(kept.location).not.toContain('error=')

      const refused = await authorize(person.headers, {
        client_id: OTHER_CLIENT_ID,
        redirect_uri: OTHER_REDIRECT_URI,
      })
      expect(`${refused.location} ${refused.body}`).toMatch(/access_denied/)
      expect(refused.location.startsWith(OTHER_REDIRECT_URI)).toBe(false)
      expect(docs.fetches).not.toContain(OTHER_CLIENT_ID)
      const rows = await testDb
        .select()
        .from(oauthClient)
        .where(eq(oauthClient.clientId, OTHER_CLIENT_ID))
      expect(rows).toHaveLength(0)
    })
  })
})
