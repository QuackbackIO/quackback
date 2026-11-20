/**
 * The OAuth device authorization grant (RFC 8628) on the real auth server and
 * real Postgres, rolled back after each test.
 *
 * A headless client registers, asks `/device/code`, a signed-in person approves
 * the user code, and the client polls the token endpoint with the device_code
 * grant. The suite pins the whole round trip and the refusals that keep a code
 * from being claimed by the wrong person.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { deviceCode, oauthResource, principal, session, settings, user } from '@/lib/server/db'
import { prepareDeviceCodeRequest } from '@/lib/server/auth/device-request'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'
import { eq } from 'drizzle-orm'

vi.hoisted(() => {
  process.env.BASE_URL = 'http://localhost:3000'
  process.env.SECRET_KEY = 'test-secret-key-for-device-grant-0123456789'
})

// The auth hooks read the request's headers; there is no server request here.
// A test that acts as a signed-in person sets them to carry that person's session.
const request = vi.hoisted(() => ({ headers: new Headers(), userId: '' }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => request.headers,
}))

// Runs the function's own validator, as the server does.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | null = null
    const chain: Record<string, unknown> = {}
    chain.validator = (next: { parse: (value: unknown) => unknown }) => {
      schema = next
      return chain
    }
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign(
        async (args?: { data?: unknown }) =>
          handler({ data: schema ? schema.parse(args?.data) : args?.data }),
        chain
      )
    return chain
  },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async () => ({
    user: { id: request.userId, email: 'dana@example.com', name: 'Dana' },
    principal: { id: 'principal_x', role: 'admin', type: 'user' },
  }),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: deviceCode.id, oauthClientId: deviceCode.oauthClientId })
      .from(deviceCode)
      .limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
  },
})

const ORIGIN = 'http://localhost:3000'
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

async function authHandler() {
  const { getAuth } = await import('@/lib/server/auth/index')
  return getAuth()
}

async function signedInBearer(): Promise<{ userId: UserId; headers: Record<string, string> }> {
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
  return { userId, headers: { authorization: `Bearer ${token}` } }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const form = headers['content-type'] === 'application/x-www-form-urlencoded'
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: form
      ? new URLSearchParams(body as Record<string, string>).toString()
      : JSON.stringify(body),
  })
}

async function registerClient(auth: Awaited<ReturnType<typeof authHandler>>) {
  const res = await auth.handler(
    post('/oauth2/register', {
      client_name: 'Headless CLI',
      grant_types: [GRANT, 'refresh_token'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      scope: 'openid offline_access read:feedback',
    })
  )
  const body = await res.clone().text()
  expect(res.status, body).toBe(201)
  return (await res.json()) as { client_id: string }
}

describe.skipIf(!fixture.available)(
  'OAuth device authorization grant (real DB, rolled back)',
  () => {
    beforeEach(async () => {
      await fixture.begin()
      // The auth instance is cached across tests but its resource row is not:
      // the rollback removes it, so each test seeds the one the plugin expects.
      // The open transaction holds that row for the whole test, so no other
      // suite builds the auth instance on this origin.
      await ensureMcpOauthResource({
        db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
        table: oauthResource,
        identifier: `${ORIGIN}/api/mcp`,
        allowedScopes: API_KEY_SCOPES,
      })
    })
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('advertises the device authorization endpoint and grant type', async () => {
      const auth = await authHandler()
      const res = await auth.handler(
        new Request(`${ORIGIN}/api/auth/.well-known/oauth-authorization-server`)
      )
      const meta = (await res.json()) as {
        device_authorization_endpoint?: string
        grant_types_supported?: string[]
      }
      expect(meta.device_authorization_endpoint).toBe(`${ORIGIN}/api/auth/device/code`)
      expect(meta.grant_types_supported).toContain(GRANT)
    })

    it('runs request, approval and token exchange end to end', async () => {
      const auth = await authHandler()
      const { client_id } = await registerClient(auth)

      const codeRes = await auth.handler(
        post('/device/code', { client_id, scope: 'openid read:feedback' })
      )
      expect(codeRes.status).toBe(200)
      const code = (await codeRes.json()) as {
        device_code: string
        user_code: string
        verification_uri: string
        verification_uri_complete: string
        interval: number
      }
      expect(code.verification_uri).toBe(`${ORIGIN}/device`)
      expect(code.verification_uri_complete).toBe(`${ORIGIN}/device?user_code=${code.user_code}`)

      // Before anyone approves, polling is told to wait.
      const pending = await auth.handler(
        post(
          '/oauth2/token',
          { grant_type: GRANT, device_code: code.device_code, client_id },
          { 'content-type': 'application/x-www-form-urlencoded' }
        )
      )
      expect(pending.status).toBe(400)
      expect(((await pending.json()) as { error: string }).error).toBe('authorization_pending')

      const { headers } = await signedInBearer()
      const verified = (await auth.api.deviceVerify({
        query: { user_code: code.user_code },
        headers: new Headers(headers),
      })) as { client_id?: string; scope?: string; status: string }
      expect(verified.status).toBe('pending')
      expect(verified.client_id).toBe(client_id)

      const approve = (await auth.api.deviceApprove({
        body: { userCode: code.user_code },
        headers: new Headers(headers),
      })) as { success: boolean }
      expect(approve.success).toBe(true)

      // The polling interval is enforced; let the window pass.
      await testDb
        .update(deviceCode)
        .set({ lastPolledAt: new Date(Date.now() - 60_000) })
        .where(eq(deviceCode.deviceCode, code.device_code))

      const token = await auth.handler(
        post(
          '/oauth2/token',
          { grant_type: GRANT, device_code: code.device_code, client_id },
          { 'content-type': 'application/x-www-form-urlencoded' }
        )
      )
      expect(token.status).toBe(200)
      const tokens = (await token.json()) as { access_token: string; token_type: string }
      expect(tokens.access_token).toBeTruthy()
      expect(tokens.token_type.toLowerCase()).toBe('bearer')

      // A code redeems once.
      const again = await auth.handler(
        post(
          '/oauth2/token',
          { grant_type: GRANT, device_code: code.device_code, client_id },
          { 'content-type': 'application/x-www-form-urlencoded' }
        )
      )
      expect(again.status).toBe(400)
    })

    it('reports access_denied when the person denies the request', async () => {
      const auth = await authHandler()
      const { client_id } = await registerClient(auth)
      const code = (await (
        await auth.handler(post('/device/code', { client_id, scope: 'openid' }))
      ).json()) as { device_code: string; user_code: string }
      const { headers } = await signedInBearer()
      await auth.api.deviceVerify({
        query: { user_code: code.user_code },
        headers: new Headers(headers),
      })
      await auth.api.deviceDeny({
        body: { userCode: code.user_code },
        headers: new Headers(headers),
      })

      await testDb
        .update(deviceCode)
        .set({ lastPolledAt: new Date(Date.now() - 60_000) })
        .where(eq(deviceCode.deviceCode, code.device_code))
      const token = await auth.handler(
        post(
          '/oauth2/token',
          { grant_type: GRANT, device_code: code.device_code, client_id },
          { 'content-type': 'application/x-www-form-urlencoded' }
        )
      )
      expect(((await token.json()) as { error: string }).error).toBe('access_denied')
    })

    it('refuses a second person approving a code the first has claimed', async () => {
      const auth = await authHandler()
      const { client_id } = await registerClient(auth)
      const code = (await (
        await auth.handler(post('/device/code', { client_id, scope: 'openid' }))
      ).json()) as { user_code: string }
      const first = await signedInBearer()
      await auth.api.deviceVerify({
        query: { user_code: code.user_code },
        headers: new Headers(first.headers),
      })
      const second = await signedInBearer()
      await expect(
        auth.api.deviceApprove({
          body: { userCode: code.user_code },
          headers: new Headers(second.headers),
        })
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('issues a token the MCP endpoint accepts, from a request with no resource', async () => {
      const auth = await authHandler()
      const { client_id } = await registerClient(auth)
      const victim = await signedInBearer()
      // What the route does to the request before the library sees it.
      const raw = new Request(`${ORIGIN}/api/auth/device/code`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ client_id, scope: 'openid read:feedback', user_id: victim.userId }),
      })
      const prepared = await prepareDeviceCodeRequest(raw, `${ORIGIN}/api/mcp`)
      const code = (await (await auth.handler(prepared)).json()) as {
        device_code: string
        user_code: string
      }
      // The caller could not pre-bind the code to someone else.
      const [row] = await testDb
        .select()
        .from(deviceCode)
        .where(eq(deviceCode.deviceCode, code.device_code))
      expect(row?.userId).toBeNull()
      expect(row?.resources).toEqual([`${ORIGIN}/api/mcp`])

      const person = await signedInBearer()
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
      await auth.api.deviceVerify({
        query: { user_code: code.user_code },
        headers: new Headers(person.headers),
      })
      await auth.api.deviceApprove({
        body: { userCode: code.user_code },
        headers: new Headers(person.headers),
      })
      await testDb
        .update(deviceCode)
        .set({ lastPolledAt: new Date(Date.now() - 60_000) })
        .where(eq(deviceCode.deviceCode, code.device_code))

      // The token request omits `resource` too; the route fills it in as it does here.
      const tokenRes = await auth.handler(
        post(
          '/oauth2/token',
          {
            grant_type: GRANT,
            device_code: code.device_code,
            client_id,
            resource: `${ORIGIN}/api/mcp`,
          },
          { 'content-type': 'application/x-www-form-urlencoded' }
        )
      )
      const { access_token } = (await tokenRes.json()) as { access_token: string }
      expect(access_token.split('.')).toHaveLength(3)

      // The MCP route verifies the signature against the server's own JWKS.
      const realFetch = globalThis.fetch
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return url.endsWith('/api/auth/jwks')
          ? auth.handler(new Request(url))
          : realFetch(input, init)
      })
      try {
        const { handleMcpRequest } = await import('@/lib/server/mcp/handler')
        const res = await handleMcpRequest(
          new Request(`${ORIGIN}/api/mcp`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              authorization: `Bearer ${access_token}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
          })
        )
        expect(res.status).toBe(200)
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('closes the library approval endpoints to HTTP, which skip the page checks', async () => {
      const auth = await authHandler()
      const { client_id } = await registerClient(auth)
      const code = (await (
        await auth.handler(post('/device/code', { client_id, scope: 'openid read:feedback' }))
      ).json()) as { device_code: string; user_code: string }
      const { headers } = await signedInBearer()

      for (const [method, path, body] of [
        ['GET', `/device?user_code=${code.user_code}`, null],
        ['POST', '/device/approve', { userCode: code.user_code }],
        ['POST', '/device/deny', { userCode: code.user_code }],
        ['POST', '/device/token', { grant_type: GRANT, device_code: code.device_code, client_id }],
      ] as const) {
        const res = await auth.handler(
          new Request(`${ORIGIN}/api/auth${path}`, {
            method,
            headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
            body: body ? JSON.stringify(body) : undefined,
          })
        )
        expect(res.status, `${method} ${path}`).toBe(404)
      }
      const [row] = await testDb.select().from(deviceCode)
      expect(row?.status).toBe('pending')
    })

    it('refuses an unregistered client', async () => {
      const auth = await authHandler()
      const res = await auth.handler(post('/device/code', { client_id: 'nope', scope: 'openid' }))
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    describe('the approval page functions', () => {
      async function openCode(scope: string) {
        const auth = await authHandler()
        const { client_id } = await registerClient(auth)
        const code = (await (
          await auth.handler(post('/device/code', { client_id, scope }))
        ).json()) as { device_code: string; user_code: string }
        const person = await signedInBearer()
        request.headers = new Headers(person.headers)
        request.userId = person.userId
        return { auth, client_id, code, person }
      }

      it('shows the code and client, then approves a narrower grant than asked', async () => {
        const { lookupDeviceCodeFn, decideDeviceCodeFn } =
          await import('@/lib/server/functions/device-auth')
        const { client_id, code, auth } = await openCode(
          'openid offline_access read:feedback write:feedback read:article'
        )
        const seen = await lookupDeviceCodeFn({ data: { userCode: code.user_code.toLowerCase() } })
        expect(seen).toMatchObject({
          state: 'ready',
          clientName: 'Headless CLI',
          userCode: code.user_code,
        })

        const decided = await decideDeviceCodeFn({
          data: {
            userCode: code.user_code,
            accept: true,
            // A hand-made request reaching past what was asked for.
            selectedScopes: ['read:feedback', 'write:settings'],
            offlineAccess: false,
          },
        })
        expect(decided).toEqual({ ok: true, status: 'approved' })

        await testDb
          .update(deviceCode)
          .set({ lastPolledAt: new Date(Date.now() - 60_000) })
          .where(eq(deviceCode.deviceCode, code.device_code))
        const token = await auth.handler(
          post(
            '/oauth2/token',
            { grant_type: GRANT, device_code: code.device_code, client_id },
            { 'content-type': 'application/x-www-form-urlencoded' }
          )
        )
        expect(token.status).toBe(200)
        const body = (await token.json()) as { scope?: string }
        expect(body.scope?.split(' ').sort()).toEqual(['openid', 'read:feedback'])
      })

      it('asks a stale session to sign in again, and approves once it is fresh', async () => {
        const { decideDeviceCodeFn } = await import('@/lib/server/functions/device-auth')
        const { code } = await openCode('openid read:feedback')
        const input = {
          userCode: code.user_code,
          accept: true,
          selectedScopes: ['read:feedback'],
          offlineAccess: false,
        }

        await testDb
          .update(session)
          .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
          .where(eq(session.userId, request.userId as UserId))
        expect(await decideDeviceCodeFn({ data: input })).toMatchObject({
          ok: false,
          code: 'RECENT_SIGN_IN_REQUIRED',
        })

        // Denying never needs a fresh sign-in.
        const [row] = await testDb.select().from(deviceCode)
        expect(row?.status).toBe('pending')

        await testDb
          .update(session)
          .set({ createdAt: new Date() })
          .where(eq(session.userId, request.userId as UserId))
        expect(await decideDeviceCodeFn({ data: input })).toEqual({ ok: true, status: 'approved' })
      })

      it('lets a stale session deny', async () => {
        const { decideDeviceCodeFn } = await import('@/lib/server/functions/device-auth')
        const { code } = await openCode('openid read:feedback')
        await testDb
          .update(session)
          .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
          .where(eq(session.userId, request.userId as UserId))
        expect(
          await decideDeviceCodeFn({
            data: {
              userCode: code.user_code,
              accept: false,
              selectedScopes: [],
              offlineAccess: false,
            },
          })
        ).toEqual({ ok: true, status: 'denied' })
      })

      it('denies on request and refuses to approve with nothing chosen', async () => {
        const { decideDeviceCodeFn } = await import('@/lib/server/functions/device-auth')
        const { code } = await openCode('openid read:feedback')
        expect(
          await decideDeviceCodeFn({
            data: {
              userCode: code.user_code,
              accept: true,
              selectedScopes: [],
              offlineAccess: false,
            },
          })
        ).toEqual({ ok: false, reason: 'no_scopes' })
        const denied = await decideDeviceCodeFn({
          data: {
            userCode: code.user_code,
            accept: false,
            selectedScopes: [],
            offlineAccess: false,
          },
        })
        expect(denied).toEqual({ ok: true, status: 'denied' })
      })

      it('tells a second account the code is not theirs, and an unknown code is invalid', async () => {
        const { lookupDeviceCodeFn } = await import('@/lib/server/functions/device-auth')
        const { code } = await openCode('openid read:feedback')
        await lookupDeviceCodeFn({ data: { userCode: code.user_code } })

        const other = await signedInBearer()
        request.headers = new Headers(other.headers)
        request.userId = other.userId
        expect(await lookupDeviceCodeFn({ data: { userCode: code.user_code } })).toEqual({
          state: 'unavailable',
        })
        expect(await lookupDeviceCodeFn({ data: { userCode: 'ZZZZZZZZ' } })).toEqual({
          state: 'invalid',
        })
      })
    })
  }
)
