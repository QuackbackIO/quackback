/**
 * Pool-cache mechanics: eviction, LRU, revision rebuild, refusal.
 *
 * The driver and the fingerprint reader are stubbed here so the cache's own
 * decisions are what is under test — the real fingerprint behaviour is proven
 * against live Neon databases, and re-proving it here would only test the stub.
 *
 * Eviction is the piece that most deserves a test, for an unusual reason: it
 * has **no functional symptom**. A cache that never evicts serves every request
 * correctly and silently holds every tenant's Neon compute awake forever. The
 * only observable is the counter, so the counter is asserted, not just the
 * behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ended: string[] = []
let observation: unknown = null
let observeError: Error | null = null

/** A postgres.js stand-in: records the DSN it was built for and its shutdown. */
const postgresFactory = vi.fn((dsn: string, options?: Record<string, unknown>) => {
  void options
  return {
    dsn,
    end: vi.fn(async () => {
      ended.push(dsn)
    }),
  }
})

vi.mock('postgres', () => ({ default: postgresFactory }))

vi.mock('@quackback/db/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, createDbFromSql: vi.fn((sql: unknown) => ({ boundTo: sql })) }
})

vi.mock('../fingerprint', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    observeTenantIdentity: vi.fn(async () => {
      if (observeError) throw observeError
      return observation
    }),
    evaluateTenantIdentity: vi.fn(() => ({ ok: true })),
  }
})

function descriptor(id: string, revision = 1) {
  return {
    tenantId: id,
    revision,
    contractVersion: 1,
    routing: { primaryHostname: `${id}.example.com`, hostnames: [], baseUrl: '' },
    database: {
      pooledUrl: `postgresql://role_${id}@pooler.example/${id}`,
      directUrl: `postgresql://role_${id}@direct.example/${id}`,
      name: id,
      role: `role_${id}`,
      credentialRef: 'env://QUACKBACK_TENANT_SECRET_TEST',
    },
    fingerprint: { expectedTenantId: id, expectedWorkspaceId: 'w', stampedAt: 's' },
    secrets: { appSecretsRef: 'openbao+kv://apps/x' },
    storage: {},
    email: { from: '' },
    features: { aiEnabled: false },
    physical: { neonProjectId: null, neonBranchId: null },
  } as never
}

async function loadCache() {
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
  vi.stubEnv('QUACKBACK_TENANT_SECRET_TEST', 'hunter2')
  return import('../pool-cache')
}

describe('tenant pool cache', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    ended.length = 0
    observeError = null
    observation = {
      workspaceId: 'w',
      stamp: null,
      settingsRowCount: 1,
      physical: { neonProjectId: null, neonBranchId: null, neonEndpointId: null },
      stampSource: 'none',
      stampSourceConflict: null,
    }
    // `clearAllMocks` clears calls but keeps implementations, so a verdict
    // stubbed by one case would silently govern every later one.
    const fp = await import('../fingerprint')
    vi.mocked(fp.evaluateTenantIdentity).mockReturnValue({ ok: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds one pool per tenant, from that tenant’s pooled DSN', async () => {
    const cache = await loadCache()
    const a = await cache.acquireTenantPool(descriptor('t1'))
    const b = await cache.acquireTenantPool(descriptor('t2'))

    expect((a.sql as unknown as { dsn: string }).dsn).toContain('/t1')
    expect((b.sql as unknown as { dsn: string }).dsn).toContain('/t2')
    expect(a.sql).not.toBe(b.sql)
    expect(cache.getPoolCacheStats().created).toBe(2)
    await cache.closeAllTenantPools()
  })

  it('reuses the pool on a second acquisition', async () => {
    const cache = await loadCache()
    const first = await cache.acquireTenantPool(descriptor('t1'))
    const second = await cache.acquireTenantPool(descriptor('t1'))
    expect(second.sql).toBe(first.sql)
    expect(cache.getPoolCacheStats().created).toBe(1)
    await cache.closeAllTenantPools()
  })

  it('rebuilds when the registry revision changes', async () => {
    // A revision bump means the control plane changed something — a rotated
    // role, a repointed database, a new fingerprint. Rebuilding is cheaper than
    // reasoning about which fields are safe to keep.
    const cache = await loadCache()
    const first = await cache.acquireTenantPool(descriptor('t1', 1))
    const second = await cache.acquireTenantPool(descriptor('t1', 2))
    expect(second.sql).not.toBe(first.sql)
    expect(cache.getPoolCacheStats().evictedByReason.revision).toBe(1)
    await cache.closeAllTenantPools()
  })

  it('closes the socket when it evicts — an unclosed pool holds the compute awake', async () => {
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    await cache.evict('t1', 'manual')
    expect(ended).toEqual([expect.stringContaining('/t1')])
  })

  it('evicts pools idle past the threshold, and counts them', async () => {
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    await cache.acquireTenantPool(descriptor('t2'))

    // Nothing is due yet.
    expect(await cache.sweepIdlePools(Date.now())).toBe(0)
    expect(cache.getPoolCacheStats().live).toBe(2)

    // Both are, a minute later (the default threshold is 45s).
    expect(await cache.sweepIdlePools(Date.now() + 60_000)).toBe(2)
    const stats = cache.getPoolCacheStats()
    expect(stats.live).toBe(0)
    expect(stats.evictedByReason.idle).toBe(2)
    // The metric §6 asks for: without it, "never evicts" and "evicts fine" look
    // identical from outside.
    expect(stats.evictionsPerHour).toBeGreaterThan(0)
    expect(ended).toHaveLength(2)
  })

  it('keeps a pool that was used recently while evicting one that was not', async () => {
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    await cache.acquireTenantPool(descriptor('t2'))

    const later = Date.now() + 60_000
    vi.setSystemTime(later)
    await cache.acquireTenantPool(descriptor('t2')) // touch t2
    vi.useRealTimers()

    expect(await cache.sweepIdlePools(later + 1_000)).toBe(1)
    expect(ended).toEqual([expect.stringContaining('/t1')])
    await cache.closeAllTenantPools()
  })

  it('evicts the least recently used pool when the cap is exceeded', async () => {
    vi.stubEnv('TENANT_POOL_MAX_ENTRIES', '2')
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    await cache.acquireTenantPool(descriptor('t2'))
    await cache.acquireTenantPool(descriptor('t1')) // t1 becomes most recent
    await cache.acquireTenantPool(descriptor('t3'))

    expect(cache.getPoolCacheStats().live).toBe(2)
    expect(cache.getPoolCacheStats().evictedByReason.lru).toBe(1)
    // t2 was the least recently used, so it is the one that goes.
    expect(ended).toEqual([expect.stringContaining('/t2')])
    await cache.closeAllTenantPools()
  })

  it('never evicts the tenant it is being asked to serve', async () => {
    vi.stubEnv('TENANT_POOL_MAX_ENTRIES', '1')
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    const served = await cache.acquireTenantPool(descriptor('t2'))
    expect((served.sql as unknown as { dsn: string }).dsn).toContain('/t2')
    expect(cache.getPoolCacheStats().live).toBe(1)
    await cache.closeAllTenantPools()
  })

  it('evicts and rethrows when the fingerprint refuses, so a retry cannot reuse it', async () => {
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.evaluateTenantIdentity).mockReturnValue({
      ok: false,
      code: 'workspace_id_mismatch',
      detail: 'settings.id is somebody else',
    })

    await expect(cache.acquireTenantPool(descriptor('t1'))).rejects.toThrow(/workspace_id_mismatch/)
    const stats = cache.getPoolCacheStats()
    expect(stats.live).toBe(0)
    expect(stats.refusals).toBe(1)
    expect(stats.evictedByReason.refused).toBe(1)
    // And the socket is closed, not leaked.
    expect(ended).toHaveLength(1)
  })

  it('refuses again on the next attempt rather than serving a cached success', async () => {
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.evaluateTenantIdentity).mockReturnValue({
      ok: false,
      code: 'stamp_missing',
      detail: 'no stamp',
    })
    await expect(cache.acquireTenantPool(descriptor('t1'))).rejects.toThrow()
    await expect(cache.acquireTenantPool(descriptor('t1'))).rejects.toThrow()
    expect(cache.getPoolCacheStats().refusals).toBe(2)
  })

  it('fails fast and by name when the credential reference cannot be resolved', async () => {
    // Left to the driver, a throwing password provider surfaces fifteen seconds
    // later as CONNECT_TIMEOUT — slow, and naming the wrong cause.
    const cache = await loadCache()
    vi.stubEnv('QUACKBACK_TENANT_SECRET_TEST', '')
    await expect(cache.acquireTenantPool(descriptor('t1'))).rejects.toThrow(
      /QUACKBACK_TENANT_SECRET_TEST, which is unset/
    )
    expect(cache.getPoolCacheStats().live).toBe(0)
  })

  it('passes a password FUNCTION to the driver so a rotation is picked up', async () => {
    // The record carries `dbRole` as a field precisely because passwords rotate
    // under a live pool. A string here would wedge the pool at the old password.
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    const options = (postgresFactory.mock.calls[0]?.[1] ?? {}) as { password?: unknown }
    expect(typeof options.password).toBe('function')
    await cache.closeAllTenantPools()
  })

  it('terminates at the POOLED endpoint, never the direct one', async () => {
    // The direct endpoint is reserved for session-mode consumers (LISTEN,
    // advisory locks, CREATE INDEX CONCURRENTLY). A web pool on it would use up
    // real backends per tenant.
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    expect(postgresFactory.mock.calls[0]?.[0]).toBe('postgresql://role_t1@pooler.example/t1')
  })

  it('keeps prepared statements on', async () => {
    const cache = await loadCache()
    await cache.acquireTenantPool(descriptor('t1'))
    const options = (postgresFactory.mock.calls[0]?.[1] ?? {}) as { prepare?: boolean; idle_timeout?: number }
    expect(options.prepare).toBe(true)
    // And the idle timeout must be well under Neon's 300s suspend window and
    // Railway's 600s sleep window, or nothing ever goes quiet.
    expect(options.idle_timeout).toBeLessThan(300)
    await cache.closeAllTenantPools()
  })
})
