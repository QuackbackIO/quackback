/**
 * The cache helpers, against a real server.
 *
 * Successor to `redis-cache.test.ts`, which asserted the wire key handed to a
 * fake ioredis (`t:workspace-alpha:settings:workspace`). There is no wire key now —
 * the discriminator is `kv_store.workspace_key` — so this asserts the row that
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
  withRealWorkspace,
  workspacePair,
  uniqueKey,
  cleanupWorkspaces,
  closeHarness,
  testSql,
} from '@/lib/server/kv/__tests__/harness'
import { cacheGet, cacheSet, cacheDel, CACHE_KEYS } from '../cache'

const [A, B] = workspacePair()

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupWorkspaces(A, B)
  await closeHarness()
})

describe('CACHE_KEYS', () => {
  it('exports the expected cache key constants', () => {
    expect(CACHE_KEYS.WORKSPACE_SETTINGS).toBe('settings:workspace')
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
    await withRealWorkspace(A, () => cacheSet(CACHE_KEYS.WORKSPACE_SETTINGS, { name: 'alpha' }, 60))
    expect(await withRealWorkspace(A, () => cacheGet(CACHE_KEYS.WORKSPACE_SETTINGS))).toEqual({
      name: 'alpha',
    })
  })

  it('returns null for a key that was never written', async () => {
    expect(await withRealWorkspace(A, () => cacheGet(uniqueKey('absent')))).toBeNull()
  })

  it('deletes several keys at once', async () => {
    await withRealWorkspace(A, () => cacheSet(CACHE_KEYS.SLACK_CHANNELS, ['a'], 60))
    await withRealWorkspace(A, () => cacheSet(CACHE_KEYS.ACTIVE_WEBHOOKS, ['b'], 60))
    await withRealWorkspace(A, () =>
      cacheDel(CACHE_KEYS.SLACK_CHANNELS, CACHE_KEYS.ACTIVE_WEBHOOKS)
    )
    expect(await withRealWorkspace(A, () => cacheGet(CACHE_KEYS.SLACK_CHANNELS))).toBeNull()
    expect(await withRealWorkspace(A, () => cacheGet(CACHE_KEYS.ACTIVE_WEBHOOKS))).toBeNull()
  })
})

describe('the workspace discriminator', () => {
  it('a key written under one workspace is not readable under the other', async () => {
    await withRealWorkspace(A, () => cacheSet(CACHE_KEYS.WORKSPACE_SETTINGS, { name: 'alpha' }, 60))
    await withRealWorkspace(B, () => cacheSet(CACHE_KEYS.WORKSPACE_SETTINGS, { name: 'bravo' }, 60))

    expect(await withRealWorkspace(A, () => cacheGet(CACHE_KEYS.WORKSPACE_SETTINGS))).toEqual({
      name: 'alpha',
    })
    expect(await withRealWorkspace(B, () => cacheGet(CACHE_KEYS.WORKSPACE_SETTINGS))).toEqual({
      name: 'bravo',
    })
  })

  it("deleting one workspace's key leaves the other's standing", async () => {
    await withRealWorkspace(A, () => cacheSet(CACHE_KEYS.WORKSPACE_SETTINGS, { name: 'alpha' }, 60))
    await withRealWorkspace(B, () => cacheSet(CACHE_KEYS.WORKSPACE_SETTINGS, { name: 'bravo' }, 60))
    await withRealWorkspace(A, () => cacheDel(CACHE_KEYS.WORKSPACE_SETTINGS))

    expect(await withRealWorkspace(A, () => cacheGet(CACHE_KEYS.WORKSPACE_SETTINGS))).toBeNull()
    expect(await withRealWorkspace(B, () => cacheGet(CACHE_KEYS.WORKSPACE_SETTINGS))).toEqual({
      name: 'bravo',
    })
  })

  it('holds for a key built by concatenation at the call site', async () => {
    // The case `CACHE_KEYS`'s own comment called out: half of these names are
    // assembled by the caller, so a scheme that applied the namespace at the key
    // table would be one `${…}:extra` away from being bypassed.
    const key = CACHE_KEYS.PRINCIPAL_BY_USER('user_collision')
    await withRealWorkspace(A, () => cacheSet(key, { role: 'admin' }, 60))
    expect(await withRealWorkspace(B, () => cacheGet(key))).toBeNull()

    const rows = await testSql()<{ workspace_key: string; key: string }[]>`
      SELECT workspace_key, key FROM kv_store WHERE key = ${key} ORDER BY workspace_key
    `
    expect(rows).toEqual([{ workspace_key: A, key: 'principal:user:user_collision' }])
  })
})
