// @vitest-environment node
/**
 * Single sign-on at the end of the plan limits grace, against real Postgres
 * and the PRODUCTION auth instance (`getAuth()`: the real hooks and the real
 * per-request gates).
 *
 * The workspace signs in only through its identity provider (password and
 * email links stored off), and its plan does not include single sign-on. The
 * provider was set up before the drop, so it keeps signing in through the
 * grace. When the grace ends on the clock nothing is written: the auth
 * instance built during the grace is still the one in use, with the provider
 * registered. The per-request gates must still refuse the provider's sign-in
 * start and let email links in, or the team would be sent to a provider the
 * plan no longer includes and have no other way in.
 *
 * Only the logger, the request headers and the provider's saved secret are
 * stood in for. Every write rolls back with the fixture transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, identityProvider, isNull, principal, settings, user } from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { planBillingOn } from '@/lib/server/domains/plan-limits/__tests__/plan-billing'

vi.hoisted(() => {
  process.env.BASE_URL = 'https://acme.com'
  process.env.SECRET_KEY = 'test-secret-key-for-sso-grace-end-0123456789abcdef'
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
  return { log, requestHeaders: new Headers(), cache: new Map<string, unknown>() }
})

vi.mock('@/lib/server/logger', () => ({ logger: hoisted.log }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestHeaders: () => hoisted.requestHeaders,
}))
// The application cache, kept in memory: its kv rows are shared by every test
// file on the database.
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    hoisted.cache.has(key) ? structuredClone(hoisted.cache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    hoisted.cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) hoisted.cache.delete(key)
  },
}))
// The provider's saved secret, as the auth layer reads it.
vi.mock(
  '@/lib/server/domains/platform-credentials/platform-credential.service',
  async (original) => ({
    ...(await original<
      typeof import('@/lib/server/domains/platform-credentials/platform-credential.service')
    >()),
    getConfiguredIntegrationTypes: async () => new Set(['auth_acme-grace-sso']),
    getPlatformCredentials: async (type: string) =>
      type === 'auth_acme-grace-sso'
        ? { clientId: 'acme-client', clientSecret: 'acme-secret', discoveryUrl: '' }
        : null,
  })
)

const fixture = await createDbTestFixture()

const DAY = 24 * 60 * 60 * 1000
const NO_SSO = {
  ...OSS_TIER_LIMITS,
  features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

describe.skipIf(!fixture.available)('single sign-on when the grace ends (real DB)', () => {
  let email: string

  async function getAuth() {
    const { getAuth } = await import('@/lib/server/auth/index')
    return getAuth()
  }

  async function post(path: string, body: Record<string, unknown>): Promise<Response> {
    const auth = await getAuth()
    return auth.handler(
      new Request(`https://acme.com/api/auth${path}`, {
        method: 'POST',
        headers: {
          host: 'acme.com',
          origin: 'https://acme.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    )
  }

  /** Where the sign-in start sends the browser, or the refusal it redirects to. */
  async function oidcStart(): Promise<string> {
    const response = await post('/sign-in/social', { provider: 'acme-grace-sso', callbackURL: '/' })
    if (response.status >= 300 && response.status < 400) {
      return response.headers.get('location') ?? ''
    }
    const text = await response.text()
    const url = response.ok ? (JSON.parse(text) as { url?: string }).url : undefined
    return url ?? `status ${response.status} ${text}`
  }

  /** The refusal a sign-in link request redirects to, or "sent". */
  async function magicLink(): Promise<string> {
    const response = await post('/sign-in/magic-link', { email, callbackURL: '/' })
    if (response.status >= 300 && response.status < 400) {
      return response.headers.get('location') ?? ''
    }
    return response.ok ? 'sent' : `status ${response.status}`
  }

  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    hoisted.cache.clear()
    hoisted.requestHeaders = new Headers({ host: 'acme.com' })
    // Signs in only through the provider; the plan does not include it.
    const values = {
      authConfig: JSON.stringify({ oauth: { password: false, magicLink: false } }),
      featureFlags: JSON.stringify({ feedback: true }),
      tierLimits: JSON.stringify(NO_SSO),
      cloud: planBillingOn() as never,
      planLimitsState: null,
    }
    const [existing] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing) {
      await testDb.update(settings).set(values).where(eq(settings.id, existing.id))
    } else {
      await testDb.insert(settings).values({
        id: createId('workspace'),
        name: 'Acme',
        slug: `acme-${suffix()}`,
        createdAt: new Date(),
        ...values,
      })
    }
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb.delete(identityProvider)
    await testDb.insert(identityProvider).values({
      registrationId: 'acme-grace-sso',
      label: 'Acme SSO',
      clientId: 'acme-client',
      authorizationUrl: 'https://idp.example.com/authorize',
      tokenUrl: 'https://idp.example.com/token',
      enabled: true,
      showButton: true,
    } as never)

    const userId = createId('user') as UserId
    email = `teammate-${suffix()}@example.com`
    await testDb.insert(user).values({ id: userId, name: 'Teammate', email, emailVerified: true })
    await testDb.insert(principal).values({
      id: createId('principal') as PrincipalId,
      userId,
      role: 'admin',
      displayName: 'Teammate',
      createdAt: new Date(),
    })
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()
    const { invalidateSettingsCache } =
      await import('@/lib/server/domains/settings/settings.helpers')
    await invalidateSettingsCache()
  })
  afterEach(async () => {
    vi.useRealTimers()
    await fixture.rollback()
  })
  afterAll(fixture.close)

  it('refuses the provider and lets email links in once the grace ends on the clock', async () => {
    // In the grace: the provider signs in, and email links stay off as stored.
    const built = await getAuth()
    expect(await oidcStart()).toMatch(/^https:\/\/idp\.example\.com\/authorize/)
    expect(await magicLink()).toContain('error=magic_link_method_not_allowed')

    // The grace ends on the clock. Nothing is written, so the instance built
    // in the grace stays in use with the provider registered.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    const { invalidatePlanLimits } =
      await import('@/lib/server/domains/plan-limits/plan-limits.service')
    await invalidatePlanLimits()
    expect(await getAuth()).toBe(built)

    expect(await oidcStart()).toContain('error=oauth_method_not_allowed')
    expect(await magicLink()).toBe('sent')
  })
})
