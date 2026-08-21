/**
 * The cache helpers, against a real server.
 *
 * Successor to `redis-cache.test.ts`, which asserted the wire key handed to a
 * fake ioredis (`t:tenant-alpha:settings:tenant`). There is no wire key now —
 * the discriminator is `kv_store.tenant_id` — so this asserts the row that
 * actually lands, including for the keys built by concatenation at the call
 * site, which is the case the old comment on `CACHE_KEYS` singled out as the
 * one a string-prefix scheme could lose.
 *
 * Failure behaviour (a cache error must read as a miss, never throw) is pinned
 * separately in `cache-failure.test.ts`, which needs a store that can be made
 * to fail on demand.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ensureKvSchema,
  withRealTenant,
  tenantPair,
  uniqueKey,
  cleanupTenants,
  closeHarness,
  testSql,
} from '@/lib/server/kv/__tests__/harness'
import { cacheGet, cacheSet, cacheDel, CACHE_KEYS } from '../cache'

const [A, B] = tenantPair()

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupTenants(A, B)
  await closeHarness()
})

describe('CACHE_KEYS', () => {
  it('exports the expected cache key constants', () => {
    expect(CACHE_KEYS.TENANT_SETTINGS).toBe('settings:tenant')
    expect(CACHE_KEYS.INTEGRATION_MAPPINGS).toBe('hooks:integration-mappings')
    expect(CACHE_KEYS.ACTIVE_WEBHOOKS).toBe('hooks:webhooks-active:v2')
    expect(CACHE_KEYS.SLACK_CHANNELS).toBe('slack:channels')
    expect(CACHE_KEYS.PLATFORM_INTEGRATION_TYPES).toBe('platform-cred:configured-types')
    expect(CACHE_KEYS.REGISTERED_AUTH_PROVIDERS).toBe('auth:registered-providers')
    expect(CACHE_KEYS.PRINCIPAL_BY_USER('user_abc')).toBe('principal:user:user_abc')
  })
})

describe('round trip', () => {
  it('stores and reads a structured value', async () => {
    await withRealTenant(A, () => cacheSet(CACHE_KEYS.TENANT_SETTINGS, { name: 'alpha' }, 60))
    expect(await withRealTenant(A, () => cacheGet(CACHE_KEYS.TENANT_SETTINGS))).toEqual({
      name: 'alpha',
    })
  })

  it('returns null for a key that was never written', async () => {
    expect(await withRealTenant(A, () => cacheGet(uniqueKey('absent')))).toBeNull()
  })

  it('deletes several keys at once', async () => {
    await withRealTenant(A, () => cacheSet(CACHE_KEYS.SLACK_CHANNELS, ['a'], 60))
    await withRealTenant(A, () => cacheSet(CACHE_KEYS.ACTIVE_WEBHOOKS, ['b'], 60))
    await withRealTenant(A, () => cacheDel(CACHE_KEYS.SLACK_CHANNELS, CACHE_KEYS.ACTIVE_WEBHOOKS))
    expect(await withRealTenant(A, () => cacheGet(CACHE_KEYS.SLACK_CHANNELS))).toBeNull()
    expect(await withRealTenant(A, () => cacheGet(CACHE_KEYS.ACTIVE_WEBHOOKS))).toBeNull()
  })
})

describe('the tenant discriminator', () => {
  it('a key written under one tenant is not readable under the other', async () => {
    await withRealTenant(A, () => cacheSet(CACHE_KEYS.TENANT_SETTINGS, { name: 'alpha' }, 60))
    await withRealTenant(B, () => cacheSet(CACHE_KEYS.TENANT_SETTINGS, { name: 'bravo' }, 60))

    expect(await withRealTenant(A, () => cacheGet(CACHE_KEYS.TENANT_SETTINGS))).toEqual({
      name: 'alpha',
    })
    expect(await withRealTenant(B, () => cacheGet(CACHE_KEYS.TENANT_SETTINGS))).toEqual({
      name: 'bravo',
    })
  })

  it("deleting one tenant's key leaves the other's standing", async () => {
    await withRealTenant(A, () => cacheSet(CACHE_KEYS.TENANT_SETTINGS, { name: 'alpha' }, 60))
    await withRealTenant(B, () => cacheSet(CACHE_KEYS.TENANT_SETTINGS, { name: 'bravo' }, 60))
    await withRealTenant(A, () => cacheDel(CACHE_KEYS.TENANT_SETTINGS))

    expect(await withRealTenant(A, () => cacheGet(CACHE_KEYS.TENANT_SETTINGS))).toBeNull()
    expect(await withRealTenant(B, () => cacheGet(CACHE_KEYS.TENANT_SETTINGS))).toEqual({
      name: 'bravo',
    })
  })

  it('holds for a key built by concatenation at the call site', async () => {
    // The case `CACHE_KEYS`'s own comment called out: half of these names are
    // assembled by the caller, so a scheme that applied the namespace at the key
    // table would be one `${…}:extra` away from being bypassed.
    const key = CACHE_KEYS.PRINCIPAL_BY_USER('user_collision')
    await withRealTenant(A, () => cacheSet(key, { role: 'admin' }, 60))
    expect(await withRealTenant(B, () => cacheGet(key))).toBeNull()

    const rows = await testSql()<{ tenant_id: string; key: string }[]>`
      SELECT tenant_id, key FROM kv_store WHERE key = ${key} ORDER BY tenant_id
    `
    expect(rows).toEqual([{ tenant_id: A, key: 'principal:user:user_collision' }])
  })
})
