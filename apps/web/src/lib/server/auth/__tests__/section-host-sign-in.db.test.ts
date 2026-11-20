// @vitest-environment node
/**
 * Signing in directly on a section host, against real Postgres and the
 * PRODUCTION auth instance (`getAuth()`: the real hooks, cookie settings,
 * trusted origins and session hooks). The workspace serves acme.com (primary)
 * and help.acme.com (the help center), read from the real settings row.
 *
 * A teammate who signs in on help.acme.com, with a password, an emailed code
 * or a sign-in link, gets a session there that never carries team authority:
 * the admin runs on the primary domain only, and a host-only session cookie
 * on a section host must not open it (nor the server functions behind it).
 * The same sign-in on acme.com is the control: it does open the admin, so the
 * gates here can tell the two apart.
 *
 * Only the logger and the request headers the server functions read are
 * stood in for. Every write rolls back with the fixture transaction. Like
 * every *.db.test.ts it is skipped when no Postgres is reachable.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { account, eq, oauthResource, principal, session, settings, user } from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.hoisted(() => {
  process.env.BASE_URL = 'https://acme.com'
  process.env.SECRET_KEY = 'test-secret-key-for-section-host-sign-in-0123456789'
})

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => {
  const log: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'child') return () => log
        if (prop === 'level') return 'info'
        if (prop === 'isLevelEnabled') return () => true
        if (prop === 'then') return undefined
        return () => undefined
      },
    }
  )
  return { log, requestHeaders: new Headers() }
})

vi.mock('@/lib/server/logger', () => ({ logger: hoisted.log }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => hoisted.requestHeaders,
}))
// Server functions run their own validator, as the server does.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
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

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: session.id, scope: session.scope }).from(session).limit(0)
  },
})

const PRIMARY = 'acme.com'
const HELP = 'help.acme.com'
const VERIFIED = '2026-11-01T00:00:00.000Z'
const PASSWORD = 'correct-horse-battery-staple'

function suffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0]!
}

function sessionCookieOf(response: Response): string {
  const found = response.headers
    .getSetCookie()
    .find((c) => c.includes('session_token=') && !/max-age=0/i.test(c))
  expect(
    found,
    `no session cookie (status ${response.status}, to ${response.headers.get('location')})`
  ).toBeTruthy()
  return cookiePair(found!)
}

describe.skipIf(!fixture.available)('signing in directly on a section host', () => {
  let teammateId: UserId
  let email: string

  async function getAuth() {
    const { getAuth } = await import('@/lib/server/auth/index')
    return getAuth()
  }

  async function scopeOf(cookie: string): Promise<string | undefined> {
    const auth = await getAuth()
    const found = (await auth.api.getSession({ headers: new Headers({ cookie }) })) as {
      session: { scope?: string }
    } | null
    return found?.session.scope
  }

  beforeEach(async () => {
    await fixture.begin()
    hoisted.requestHeaders = new Headers()
    await ensureMcpOauthResource({
      db: testDb as unknown as Parameters<typeof ensureMcpOauthResource>[0]['db'],
      table: oauthResource,
      identifier: 'https://acme.com/api/mcp',
      allowedScopes: API_KEY_SCOPES,
    })
    // The help center on its own verified host, read from the real row.
    const portalConfig = JSON.stringify({
      sectionDomains: { help: { hostname: HELP, verifiedAt: VERIFIED } },
    })
    const featureFlags = JSON.stringify({ feedback: true, helpCenter: true })
    // Password and emailed sign-in (link or code) both on.
    const authConfig = JSON.stringify({ oauth: { password: true, magicLink: true } })
    const [existing] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing) {
      await testDb
        .update(settings)
        .set({ portalConfig, featureFlags, authConfig })
        .where(eq(settings.id, existing.id))
    } else {
      await testDb.insert(settings).values({
        id: createId('workspace'),
        name: 'Acme',
        slug: `acme-${suffix()}`,
        createdAt: new Date(),
        portalConfig,
        featureFlags,
        authConfig,
      })
    }

    // A teammate (an admin) with a password.
    teammateId = createId('user') as UserId
    email = `teammate-${suffix()}@example.com`
    await testDb.insert(user).values({
      id: teammateId,
      name: 'Teammate',
      email,
      emailVerified: true,
    })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId: teammateId,
      role: 'admin',
      displayName: 'Teammate',
      createdAt: new Date(),
    })
    const context = await (await getAuth()).$context
    await testDb.insert(account).values({
      id: createId('account' as never) as unknown as string,
      accountId: teammateId,
      providerId: 'credential',
      userId: teammateId,
      password: await context.password.hash(PASSWORD),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof account.$inferInsert)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  /** A password sign-in posted from `host`, as the browser there sends it. */
  async function passwordSignIn(host: string): Promise<Response> {
    const auth = await getAuth()
    return auth.handler(
      new Request(`https://${host}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          host,
          origin: `https://${host}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, password: PASSWORD }),
      })
    )
  }

  /** A sign-in link followed on `host`, through the library's own verify. */
  async function magicLinkSignIn(host: string): Promise<Response> {
    const { mintMagicLinkUrl } = await import('@/lib/server/auth/magic-link-mint')
    const { token } = await mintMagicLinkUrl({
      email,
      callbackPath: '/',
      portalUrl: `https://${host}`,
    })
    const auth = await getAuth()
    const query = new URLSearchParams({ token, callbackURL: '/' })
    return auth.handler(
      new Request(`https://${host}/api/auth/magic-link/verify?${query.toString()}`, {
        headers: { host },
      })
    )
  }

  /** An emailed code entered on `host`. */
  async function otpSignIn(host: string): Promise<Response> {
    const auth = await getAuth()
    const context = await auth.$context
    const otp = '123456'
    await context.internalAdapter.createVerificationValue({
      identifier: `sign-in-otp-${email}`,
      value: `${otp}:0`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    return auth.handler(
      new Request(`https://${host}/api/auth/sign-in/email-otp`, {
        method: 'POST',
        headers: {
          host,
          origin: `https://${host}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, otp }),
      })
    )
  }

  async function adminGateOutcome(cookie: string): Promise<'opens' | 'refused'> {
    hoisted.requestHeaders = new Headers({ cookie })
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    return requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'], callbackUrl: '/admin' },
    }).then(
      () => 'opens' as const,
      () => 'refused' as const
    )
  }

  async function dashboardGateOutcome(cookie: string): Promise<'opens' | 'refused'> {
    hoisted.requestHeaders = new Headers({ cookie })
    const { requireAuth, assertDashboardScope } =
      await import('@/lib/server/functions/auth-helpers')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
      assertDashboardScope(auth)
      return 'opens'
    } catch {
      return 'refused'
    }
  }

  it.each([
    ['a password', passwordSignIn],
    ['a sign-in link', magicLinkSignIn],
    ['an emailed code', otpSignIn],
  ])('%s on the primary domain opens the admin (the control)', async (_name, signIn) => {
    const cookie = sessionCookieOf(await signIn(PRIMARY))
    expect(await scopeOf(cookie)).toBe('dashboard')
    expect(await adminGateOutcome(cookie)).toBe('opens')
    expect(await dashboardGateOutcome(cookie)).toBe('opens')
  })

  it.each([
    ['a password', passwordSignIn],
    ['a sign-in link', magicLinkSignIn],
    ['an emailed code', otpSignIn],
  ])('%s on a section host signs in without team authority', async (_name, signIn) => {
    const cookie = sessionCookieOf(await signIn(HELP))
    expect(await scopeOf(cookie)).toBe('portal')
    expect(await adminGateOutcome(cookie)).toBe('refused')
    expect(await dashboardGateOutcome(cookie)).toBe('refused')

    // Still signed in there, as a portal visitor.
    hoisted.requestHeaders = new Headers({ cookie })
    const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
    const plain = await requireAuth()
    expect(plain.user.id).toBe(teammateId)
    expect(plain.principal.role).toBe('user')
    expect(plain.permissions).toEqual([])
  })

  it('also when the host differs only in case, port or trailing dot', async () => {
    const cookie = sessionCookieOf(
      await (
        await getAuth()
      ).handler(
        new Request(`https://${HELP}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            host: 'Help.Acme.com.:443',
            origin: `https://${HELP}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ email, password: PASSWORD }),
        })
      )
    )
    expect(await scopeOf(cookie)).toBe('portal')
  })
})
