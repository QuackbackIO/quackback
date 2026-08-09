/**
 * The `REGISTERED_AUTH_PROVIDERS` cache, driven through the read path the login
 * UI actually uses.
 *
 * ## Why this file exists as well as `redis-cache.test.ts`
 *
 * That suite proves `cacheGet`/`cacheSet` prefix the key they are handed. This
 * one proves the thing the prefix was for: that
 * `getRegisteredAuthProviders()` — the function `BootstrapData` calls on every
 * app boot — cannot serve one workspace the identity providers of another.
 *
 * The distinction is not academic. The Piece 1 critic planted exactly this
 * hazard against the live two-tenant fleet ("bravo's `/api/auth/providers`
 * offers alpha's OIDC provider") and the nine-family isolation probe suite
 * returned `PASS exit=0`. A provider id is a plausible string on either
 * workspace, so nothing about the response looks wrong from outside. The suite
 * documents nine families and never claimed §4 exhaustiveness; this is one of
 * the three §4 hazards it is blind to, and it needs an assertion of its own.
 *
 * ## What is faked, and what is not
 *
 * **`ioredis` is faked, not `@/lib/server/redis`.** That distinction is the
 * whole value of this file: mocking the cache helpers would mean asserting
 * against a reimplementation of the namespacing rather than against the real
 * `cacheGet`/`cacheSet`, and the test would stay green with the production
 * namespacing removed. Here the real helpers and the real `tenantKey` run, and
 * the only fake is the socket.
 *
 * The store behind that socket is a single shared `Map`, deliberately: the
 * hazard is that this cache SURVIVES a restart and is shared between tenants,
 * so a per-tenant fake store would assume away the thing under test. One map
 * for both tenants, exactly as one Redis is one Redis, and the separation has
 * to come from the key.
 *
 * The database reads are stubbed per tenant so the two workspaces have
 * genuinely different providers — otherwise every assertion below would hold
 * with the namespacing removed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface TenantFixture {
  identityProviders: { registrationId: string; enabled: boolean }[]
  configuredTypes: string[]
  oauth: Record<string, boolean>
  customOidcProvider: boolean
}

const hoisted = vi.hoisted(() => ({
  /** One store for both tenants. A shared Redis is the premise, not a bug. */
  redis: new Map<string, string>(),
  redisGets: [] as string[],
  redisSets: [] as string[],
  fixtures: new Map<string, TenantFixture>(),
  currentTenantId: (): string => '',
}))

function fixture(): TenantFixture {
  return (
    hoisted.fixtures.get(hoisted.currentTenantId()) ?? {
      identityProviders: [],
      configuredTypes: [],
      oauth: {},
      customOidcProvider: false,
    }
  )
}

vi.mock('ioredis', () => ({
  default: class FakeRedis {
    async get(key: string) {
      hoisted.redisGets.push(key)
      return hoisted.redis.get(key) ?? null
    }
    async set(key: string, value: string) {
      hoisted.redisSets.push(key)
      hoisted.redis.set(key, value)
      return 'OK'
    }
    async del(...keys: string[]) {
      for (const k of keys) hoisted.redis.delete(k)
      return keys.length
    }
    on() {
      return this
    }
  },
}))
vi.mock('@/lib/server/config', () => ({ config: { redisUrl: 'redis://localhost:6379' } }))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: async () => ({ authConfig: { oauth: fixture().oauth } }),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({
    features: { customOidcProvider: fixture().customOidcProvider },
  }),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: async () => new Set(fixture().configuredTypes),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => fixture().identityProviders,
}))

const { getRegisteredAuthProviders, getRegisteredOidcProviderIds } =
  await import('../registered-providers')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')
const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')

hoisted.currentTenantId = () => getCurrentTenant()?.tenantId ?? ''

const ALPHA: TenantFixture = {
  identityProviders: [{ registrationId: 'alpha-workforce-idp', enabled: true }],
  configuredTypes: ['auth_alpha-workforce-idp', 'auth_google'],
  oauth: { google: true },
  customOidcProvider: true,
}
const BRAVO: TenantFixture = {
  identityProviders: [{ registrationId: 'bravo-partner-idp', enabled: true }],
  configuredTypes: ['auth_bravo-partner-idp'],
  oauth: {},
  customOidcProvider: true,
}

beforeEach(() => {
  hoisted.redis.clear()
  hoisted.redisGets.length = 0
  hoisted.redisSets.length = 0
  hoisted.fixtures.clear()
  hoisted.fixtures.set('tenant-alpha', ALPHA)
  hoisted.fixtures.set('tenant-bravo', BRAVO)
})

describe('the fixture reaches the code under test', () => {
  // Falsification discipline: the assertions below are negatives ("bravo does
  // not offer alpha's provider"), and a negative holds trivially in a fixture
  // that never produces a provider at all. These two pin that each workspace
  // really does compute its own non-empty list first.
  it('alpha computes its own provider ids', async () => {
    expect(await withTenant('tenant-alpha', () => getRegisteredAuthProviders())).toEqual([
      'alpha-workforce-idp',
      'google',
    ])
  })

  it('bravo computes its own provider ids', async () => {
    expect(await withTenant('tenant-bravo', () => getRegisteredAuthProviders())).toEqual([
      'bravo-partner-idp',
    ])
  })

  it('the cache is really a cache — the second call does not recompute', async () => {
    await withTenant('tenant-alpha', () => getRegisteredAuthProviders())
    hoisted.redisSets.length = 0
    await withTenant('tenant-alpha', () => getRegisteredAuthProviders())

    expect(hoisted.redisSets).toEqual([])
  })
})

describe('REGISTERED_AUTH_PROVIDERS does not cross tenants', () => {
  it('bravo is not offered alpha’s OIDC provider when alpha primed the cache', async () => {
    await withTenant('tenant-alpha', () => getRegisteredAuthProviders())
    const bravo = await withTenant('tenant-bravo', () => getRegisteredAuthProviders())

    expect(bravo).not.toContain('alpha-workforce-idp')
    expect(bravo).not.toContain('google')
    expect(bravo).toEqual(['bravo-partner-idp'])
  })

  it('alpha is not offered bravo’s OIDC provider when bravo primed the cache', async () => {
    // Both directions. The Piece 1 round-4 finding was that detection depended
    // on which tenant's value happened to survive a shared Map, so a
    // one-directional check here would be the same defect in a new place.
    await withTenant('tenant-bravo', () => getRegisteredAuthProviders())
    const alpha = await withTenant('tenant-alpha', () => getRegisteredAuthProviders())

    expect(alpha).not.toContain('bravo-partner-idp')
    expect(alpha).toEqual(['alpha-workforce-idp', 'google'])
  })

  it('writes and reads two distinct Redis keys for the same logical key', async () => {
    await withTenant('tenant-alpha', () => getRegisteredAuthProviders())
    await withTenant('tenant-bravo', () => getRegisteredAuthProviders())

    expect(hoisted.redisSets).toEqual([
      't:tenant-alpha:auth:registered-providers',
      't:tenant-bravo:auth:registered-providers',
    ])
    expect(new Set(hoisted.redisGets).size).toBe(2)
  })

  it('survives the cache: a value written under one tenant is unreachable from the other', async () => {
    // Plant alpha's answer directly, then ask bravo. This is the restart case —
    // the entry is already in Redis, nothing recomputed it this process.
    await withTenant('tenant-alpha', () => getRegisteredAuthProviders())
    hoisted.fixtures.set('tenant-bravo', { ...BRAVO, identityProviders: [], configuredTypes: [] })

    const bravo = await withTenant('tenant-bravo', () => getRegisteredAuthProviders())

    expect(bravo).toEqual([])
  })
})

describe('the shared OIDC gate underneath it', () => {
  // getRegisteredOidcProviderIds is what the ENFORCEMENT path reads
  // (isHardBound / isAuthMethodAllowed), not just the UI mirror. It takes no
  // cache, but it reads getTierLimits() — which is itself a §4 cache — so a
  // leak there would surface here as a provider registering on the wrong plan.
  it('gates on the ACTIVE tenant’s tier flag, not a neighbour’s', async () => {
    hoisted.fixtures.set('tenant-bravo', { ...BRAVO, customOidcProvider: false })

    expect([...(await withTenant('tenant-alpha', () => getRegisteredOidcProviderIds()))]).toEqual([
      'alpha-workforce-idp',
    ])
    expect([...(await withTenant('tenant-bravo', () => getRegisteredOidcProviderIds()))]).toEqual(
      []
    )
  })
})
