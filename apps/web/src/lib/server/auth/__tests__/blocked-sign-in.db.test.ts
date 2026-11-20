// @vitest-environment node
/**
 * A blocked person cannot sign in again (owner decision D7), against real
 * Postgres and the PRODUCTION auth instance (`getAuth()`: the real hooks and
 * session hooks).
 *
 * The refusal comes only after the person has proved who they are (the right
 * password, a followed sign-in link, a correct emailed code), so it tells
 * nobody who merely types an address that the account is blocked, and it says
 * no more than the existing blocked message. No session survives it.
 *
 * The same sign-ins succeed for the person unblocked (the control).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { account, eq, oauthResource, principal, session, settings, user } from '@/lib/server/db'
import { ensureMcpOauthResource } from '@/lib/server/auth/ensure-mcp-oauth-resource'
import { API_KEY_SCOPES } from '@/lib/server/domains/api-keys/api-key-scopes'

vi.hoisted(() => {
  process.env.BASE_URL = 'https://acme.com'
  process.env.SECRET_KEY = 'test-secret-key-for-blocked-sign-in-0123456789abcdef'
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

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: principal.id, blockedAt: principal.blockedAt }).from(principal).limit(0)
  },
})

const HOST = 'acme.com'
const PASSWORD = 'correct-horse-battery-staple'
const BLOCKED_MESSAGE = 'This account is blocked.'

/** Session cookies the response sets that are not being cleared. */
function liveSessionCookies(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .filter((c) => c.includes('session_token=') && !/max-age=0/i.test(c))
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

describe.skipIf(!fixture.available)('a blocked person signing in', () => {
  let personUserId: UserId
  let personId: PrincipalId
  let email: string

  async function getAuth() {
    const { getAuth } = await import('@/lib/server/auth/index')
    return getAuth()
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
    const authConfig = JSON.stringify({ oauth: { password: true, magicLink: true } })
    const featureFlags = JSON.stringify({ feedback: true })
    const [existing] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing) {
      await testDb
        .update(settings)
        .set({ authConfig, featureFlags, portalConfig: null })
        .where(eq(settings.id, existing.id))
    } else {
      await testDb.insert(settings).values({
        id: createId('workspace'),
        name: 'Acme',
        slug: `acme-${suffix()}`,
        createdAt: new Date(),
        authConfig,
        featureFlags,
      })
    }

    // A portal user with a password.
    personUserId = createId('user') as UserId
    personId = createId('principal') as PrincipalId
    email = `riley-${suffix()}@example.com`
    await testDb
      .insert(user)
      .values({ id: personUserId, name: 'Riley', email, emailVerified: true })
    await testDb.insert(principal).values({
      id: personId,
      userId: personUserId,
      role: 'user',
      type: 'user',
      displayName: 'Riley',
      createdAt: new Date(),
    })
    const context = await (await getAuth()).$context
    await testDb.insert(account).values({
      id: createId('account' as never) as unknown as string,
      accountId: personUserId,
      providerId: 'credential',
      userId: personUserId,
      password: await context.password.hash(PASSWORD),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof account.$inferInsert)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function block(): Promise<void> {
    await testDb.update(principal).set({ blockedAt: new Date() }).where(eq(principal.id, personId))
  }

  async function liveSessions(): Promise<number> {
    const rows = await testDb
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, personUserId))
    return rows.length
  }

  function passwordSignIn(): Promise<Response> {
    return getAuth().then((auth) =>
      auth.handler(
        new Request(`https://${HOST}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: PASSWORD }),
        })
      )
    )
  }

  async function otpSignIn(): Promise<Response> {
    const auth = await getAuth()
    const context = await auth.$context
    const otp = '123456'
    await context.internalAdapter.createVerificationValue({
      identifier: `sign-in-otp-${email}`,
      value: `${otp}:0`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    return auth.handler(
      new Request(`https://${HOST}/api/auth/sign-in/email-otp`, {
        method: 'POST',
        headers: { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })
    )
  }

  async function magicLinkSignIn(): Promise<Response> {
    const { mintMagicLinkUrl } = await import('@/lib/server/auth/magic-link-mint')
    const { token } = await mintMagicLinkUrl({
      email,
      callbackPath: '/',
      portalUrl: `https://${HOST}`,
    })
    const auth = await getAuth()
    const query = new URLSearchParams({ token, callbackURL: '/' })
    return auth.handler(
      new Request(`https://${HOST}/api/auth/magic-link/verify?${query.toString()}`, {
        headers: { host: HOST },
      })
    )
  }

  it.each([
    ['a password', passwordSignIn],
    ['an emailed code', otpSignIn],
  ])('%s is refused with the blocked message and no session', async (_name, signIn) => {
    await block()
    const response = await signIn()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'account_blocked',
      message: BLOCKED_MESSAGE,
    })
    expect(liveSessionCookies(response)).toEqual([])
    expect(await liveSessions()).toBe(0)
  })

  it('a followed sign-in link lands on the sign-in page with the blocked code and no session', async () => {
    await block()
    const response = await magicLinkSignIn()
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!, `https://${HOST}`)
    expect(location.pathname).toBe('/')
    expect(location.searchParams.get('auth')).toBe('signin')
    expect(location.searchParams.get('error')).toBe('account_blocked')
    expect(liveSessionCookies(response)).toEqual([])
    expect(await liveSessions()).toBe(0)
  })

  it.each([
    ['a password', passwordSignIn],
    ['an emailed code', otpSignIn],
    ['a sign-in link', magicLinkSignIn],
  ])('%s still signs the person in when not blocked (the control)', async (_name, signIn) => {
    const response = await signIn()
    expect([200, 302]).toContain(response.status)
    expect(response.headers.get('location') ?? '').not.toContain('error=')
    expect(liveSessionCookies(response)).toHaveLength(1)
    expect(await liveSessions()).toBe(1)
  })
})
