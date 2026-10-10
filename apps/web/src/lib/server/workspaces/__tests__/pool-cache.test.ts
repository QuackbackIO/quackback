/**
 * Pool-cache mechanics: eviction, LRU, revision rebuild, refusal.
 *
 * The driver and the fingerprint reader are stubbed here so the cache's own
 * decisions are what is under test — the real fingerprint behaviour is proven
 * against live workspace databases, and re-proving it here would only test the stub.
 *
 * Eviction is the piece that most deserves a test, for an unusual reason: it
 * has **no functional symptom**. A cache that never evicts serves every request
 * correctly and silently holds every workspace's compute awake forever. The
 * only observable is the counter, so the counter is asserted, not just the
 * behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveWorkspaceSecret, sealSecretKeyCanary } from '../vendor/fleet-secrets'

/** The fleet root this fixture derives every workspace's SECRET_KEY from. */
const ROOT_KEY = 'pool-cache-test-fleet-root-key-0123456789'
const STORAGE_ENV_VAR = 'QUACKBACK_TENANT_SECRET_STORAGE_TEST'

/** The canary a workspace's own derived key opens. */
function canaryFor(workspaceKey: string): string {
  return sealSecretKeyCanary(
    deriveWorkspaceSecret(ROOT_KEY, { generation: 1, workspaceKey, purpose: 'app-secrets' }),
    workspaceKey
  )
}

/**
 * The canary is per workspace by construction, so the stub has to be too: a fixture
 * that handed every workspace one canary would make the pool cache's key check pass
 * for the wrong reason. The workspace is recovered from the DSN the stubbed driver
 * recorded, which is the only workspace-identifying thing `observeWorkspaceIdentity`
 * is given.
 */
async function defaultObservation(sql: { dsn?: string }) {
  if (observeError) throw observeError
  const workspaceKey = /\/([^/?]+)$/.exec(sql?.dsn ?? '')?.[1] ?? 't1'
  return { ...(observation as Record<string, unknown>), secretCanary: canaryFor(workspaceKey) }
}

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

vi.mock('@/lib/server/fleet/ensure-schema-current', () => ({
  ensureWorkspaceSchemaCurrent: vi.fn(async () => {}),
}))

vi.mock('../fingerprint', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    // The canary is per workspace by construction, so the stub has to be too: a
    // fixture that handed every workspace one canary would make the pool cache's
    // key check pass for the wrong reason.
    observeWorkspaceIdentity: vi.fn(defaultObservation),
    evaluateWorkspaceIdentity: vi.fn(() => ({ ok: true })),
  }
})

function descriptor(id: string, revision = 1) {
  return {
    workspaceKey: id,
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
    fingerprint: { expectedWorkspaceKey: id, expectedSelfReportedWorkspaceId: 'w', stampedAt: 's' },
    secrets: { appSecretsRef: `derived+hkdf://v1/${id}/app-secrets` },
    storage: { credentialRef: `env://${STORAGE_ENV_VAR}` },
    email: { from: '' },
    features: { aiEnabled: false },
    physical: { catalogName: null, catalogOid: null, clusterId: null },
  } as never
}

async function loadCache() {
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
  vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
  vi.stubEnv('QUACKBACK_TENANT_SECRET_TEST', 'hunter2')
  vi.stubEnv('QUACKBACK_FLEET_ROOT_KEY', ROOT_KEY)
  vi.stubEnv(STORAGE_ENV_VAR, '{"accessKeyId":"AK","secretAccessKey":"SK-0123456789abcdef"}')
  return import('../pool-cache')
}

describe('workspace pool cache', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    ended.length = 0
    observeError = null
    observation = {
      workspaceId: 'w',
      stamp: null,
      settingsRowCount: 1,
      physical: {
        currentDatabase: null,
        catalogOid: null,
      },
      stampSource: 'none',
      stampSourceConflict: null,
      secretCanary: null,
      // The ordinary healthy workspace: the resolved key opens ciphertext the
      // database was already holding. Cases below override it.
      storedCiphertext: { kind: 'opened', source: 'jwks.private_key' },
    }
    // `clearAllMocks` clears calls but keeps implementations, so a verdict or an
    // observation stubbed by one case would silently govern every later one.
    const fp = await import('../fingerprint')
    vi.mocked(fp.evaluateWorkspaceIdentity).mockReturnValue({ ok: true })
    vi.mocked(fp.observeWorkspaceIdentity).mockImplementation(defaultObservation as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds one pool per workspace, from that workspace’s pooled DSN', async () => {
    const cache = await loadCache()
    const a = await cache.acquireWorkspacePool(descriptor('t1'))
    const b = await cache.acquireWorkspacePool(descriptor('t2'))

    expect((a.sql as unknown as { dsn: string }).dsn).toContain('/t1')
    expect((b.sql as unknown as { dsn: string }).dsn).toContain('/t2')
    expect(a.sql).not.toBe(b.sql)
    expect(cache.getPoolCacheStats().created).toBe(2)
    await cache.closeAllWorkspacePools()
  })

  it('reuses the pool on a second acquisition', async () => {
    const cache = await loadCache()
    const first = await cache.acquireWorkspacePool(descriptor('t1'))
    const second = await cache.acquireWorkspacePool(descriptor('t1'))
    expect(second.sql).toBe(first.sql)
    expect(cache.getPoolCacheStats().created).toBe(1)
    await cache.closeAllWorkspacePools()
  })

  it('rebuilds when the registry revision changes', async () => {
    // A revision bump means the control plane changed something — a rotated
    // role, a repointed database, a new fingerprint. Rebuilding is cheaper than
    // reasoning about which fields are safe to keep.
    const cache = await loadCache()
    const first = await cache.acquireWorkspacePool(descriptor('t1', 1))
    const second = await cache.acquireWorkspacePool(descriptor('t1', 2))
    expect(second.sql).not.toBe(first.sql)
    expect(cache.getPoolCacheStats().evictedByReason.revision).toBe(1)
    await cache.closeAllWorkspacePools()
  })

  it('closes the socket when it evicts — an unclosed pool holds the compute awake', async () => {
    const cache = await loadCache()
    await cache.acquireWorkspacePool(descriptor('t1'))
    await cache.evict('t1', 'manual')
    expect(ended).toEqual([expect.stringContaining('/t1')])
  })

  it('evicts pools idle past the threshold, and counts them', async () => {
    const cache = await loadCache()
    await cache.acquireWorkspacePool(descriptor('t1'))
    await cache.acquireWorkspacePool(descriptor('t2'))

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
    await cache.acquireWorkspacePool(descriptor('t1'))
    await cache.acquireWorkspacePool(descriptor('t2'))

    const later = Date.now() + 60_000
    vi.setSystemTime(later)
    await cache.acquireWorkspacePool(descriptor('t2')) // touch t2
    vi.useRealTimers()

    expect(await cache.sweepIdlePools(later + 1_000)).toBe(1)
    expect(ended).toEqual([expect.stringContaining('/t1')])
    await cache.closeAllWorkspacePools()
  })

  it('evicts the least recently used pool when the cap is exceeded', async () => {
    vi.stubEnv('WORKSPACE_POOL_MAX_ENTRIES', '2')
    const cache = await loadCache()
    await cache.acquireWorkspacePool(descriptor('t1'))
    await cache.acquireWorkspacePool(descriptor('t2'))
    await cache.acquireWorkspacePool(descriptor('t1')) // t1 becomes most recent
    await cache.acquireWorkspacePool(descriptor('t3'))

    expect(cache.getPoolCacheStats().live).toBe(2)
    expect(cache.getPoolCacheStats().evictedByReason.lru).toBe(1)
    // t2 was the least recently used, so it is the one that goes.
    expect(ended).toEqual([expect.stringContaining('/t2')])
    await cache.closeAllWorkspacePools()
  })

  it('never evicts the workspace it is being asked to serve', async () => {
    vi.stubEnv('WORKSPACE_POOL_MAX_ENTRIES', '1')
    const cache = await loadCache()
    await cache.acquireWorkspacePool(descriptor('t1'))
    const served = await cache.acquireWorkspacePool(descriptor('t2'))
    expect((served.sql as unknown as { dsn: string }).dsn).toContain('/t2')
    expect(cache.getPoolCacheStats().live).toBe(1)
    await cache.closeAllWorkspacePools()
  })

  it('evicts and rethrows when the fingerprint refuses, so a retry cannot reuse it', async () => {
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.evaluateWorkspaceIdentity).mockReturnValue({
      ok: false,
      code: 'self_reported_workspace_id_mismatch',
      detail: 'settings.id is somebody else',
    })

    await expect(cache.acquireWorkspacePool(descriptor('t1'))).rejects.toThrow(
      /self_reported_workspace_id_mismatch/
    )
    const stats = cache.getPoolCacheStats()
    expect(stats.live).toBe(0)
    expect(stats.refusals).toBe(1)
    expect(stats.evictedByReason.refused).toBe(1)
    // And the socket is closed, not leaked.
    expect(ended).toHaveLength(1)
  })

  it('refuses a workspace whose SECRET_KEY does not open its canary', async () => {
    // The §3 idea applied to the key. The database can be exactly the right one
    // — the fingerprint here is stubbed to `ok` — and the fleet still must not
    // serve, because the first write would seal data under a key that cannot
    // open what is already there. `SAAS-HOSTING-STACK.md` §4.3: that damage is
    // silent and permanent, so "refuse" is the only defensible answer.
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.observeWorkspaceIdentity).mockImplementation((async () => ({
      ...(observation as Record<string, unknown>),
      // A canary sealed under a DIFFERENT workspace's derived key: the shape a
      // mis-wired root or a restored-from-elsewhere database produces.
      secretCanary: canaryFor('some-other-workspace'),
    })) as never)

    await expect(cache.acquireWorkspacePool(descriptor('t1'))).rejects.toThrow(
      /secret_key_canary_mismatch/
    )
    expect(cache.getPoolCacheStats().live).toBe(0)
    expect(cache.getPoolCacheStats().refusals).toBe(1)
    expect(ended).toHaveLength(1)
  })

  it('refuses a workspace with no canary at all, rather than treating absence as consent', async () => {
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.observeWorkspaceIdentity).mockImplementation((async () => ({
      ...(observation as Record<string, unknown>),
      secretCanary: null,
    })) as never)

    await expect(cache.acquireWorkspacePool(descriptor('t1'))).rejects.toThrow(
      /secret_key_canary_missing/
    )
  })

  it('refuses a workspace whose key opens the canary but not its own stored ciphertext', async () => {
    // The measured failure, at the layer that is supposed to catch it. Custody
    // moved and the canary was re-stamped under the new key over a database
    // nobody re-encrypted, so the canary opens and the data does not. Serving
    // this workspace is how it became eighteen hours of untyped 500s instead of
    // one refusal at checkout.
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.observeWorkspaceIdentity).mockImplementation((async (sql: { dsn?: string }) => ({
      ...((await defaultObservation(sql)) as Record<string, unknown>),
      storedCiphertext: { kind: 'unopenable', source: 'jwks.private_key' },
    })) as never)

    await expect(cache.acquireWorkspacePool(descriptor('t1'))).rejects.toThrow(
      /secret_key_stored_ciphertext_mismatch/
    )
    expect(cache.getPoolCacheStats().live).toBe(0)
    expect(cache.getPoolCacheStats().refusals).toBe(1)
    expect(ended).toHaveLength(1)
  })

  it('serves a workspace that has nothing encrypted yet — absence is not a refusal', async () => {
    // A workspace that has never signed anything holds no ciphertext, so there
    // is nothing a wrong key could fail to open and nothing serving can damage.
    // Refusing here would turn "brand new workspace" into an outage, which is the
    // opposite of what the check is for.
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.observeWorkspaceIdentity).mockImplementation((async (sql: { dsn?: string }) => ({
      ...((await defaultObservation(sql)) as Record<string, unknown>),
      storedCiphertext: { kind: 'absent', source: 'jwks.private_key', reason: 'no-row' },
    })) as never)

    const pool = await cache.acquireWorkspacePool(descriptor('t1'))
    expect(pool.secrets.secretKey).toBeTruthy()
    await cache.closeAllWorkspacePools()
  })

  it('serves when the canary DOES open — the positive control for both refusals', async () => {
    const cache = await loadCache()
    const pool = await cache.acquireWorkspacePool(descriptor('t1'))
    expect(pool.secrets.secretKey).toBeTruthy()
    expect(pool.secrets.storage).toEqual({
      accessKeyId: 'AK',
      secretAccessKey: 'SK-0123456789abcdef',
    })
    await cache.closeAllWorkspacePools()
  })

  it('refuses again on the next attempt rather than serving a cached success', async () => {
    const cache = await loadCache()
    const fp = await import('../fingerprint')
    vi.mocked(fp.evaluateWorkspaceIdentity).mockReturnValue({
      ok: false,
      code: 'stamp_missing',
      detail: 'no stamp',
    })
    await expect(cache.acquireWorkspacePool(descriptor('t1'))).rejects.toThrow()
    await expect(cache.acquireWorkspacePool(descriptor('t1'))).rejects.toThrow()
    expect(cache.getPoolCacheStats().refusals).toBe(2)
  })

  it('fails fast and by name when the credential reference cannot be resolved', async () => {
    // Left to the driver, a throwing password provider surfaces fifteen seconds
    // later as CONNECT_TIMEOUT — slow, and naming the wrong cause.
    const cache = await loadCache()
    vi.stubEnv('QUACKBACK_TENANT_SECRET_TEST', '')
    await expect(cache.acquireWorkspacePool(descriptor('t1'))).rejects.toThrow(
      /QUACKBACK_TENANT_SECRET_TEST, which is unset/
    )
    expect(cache.getPoolCacheStats().live).toBe(0)
  })

  it('passes a password FUNCTION to the driver so a rotation is picked up', async () => {
    // The record carries `dbRole` as a field precisely because passwords rotate
    // under a live pool. A string here would wedge the pool at the old password.
    const cache = await loadCache()
    await cache.acquireWorkspacePool(descriptor('t1'))
    const options = (postgresFactory.mock.calls[0]?.[1] ?? {}) as { password?: unknown }
    expect(typeof options.password).toBe('function')
    await cache.closeAllWorkspacePools()
  })

  it('terminates at the POOLED endpoint, never the direct one', async () => {
    // The direct endpoint is reserved for session-mode consumers (LISTEN,
    // advisory locks, CREATE INDEX CONCURRENTLY). A web pool on it would use up
    // real backends per workspace.
    const cache = await loadCache()
    await cache.acquireWorkspacePool(descriptor('t1'))
    expect(postgresFactory.mock.calls[0]?.[0]).toBe('postgresql://role_t1@pooler.example/t1')
  })

  it('keeps prepared statements on', async () => {
    const cache = await loadCache()
    await cache.acquireWorkspacePool(descriptor('t1'))
    const options = (postgresFactory.mock.calls[0]?.[1] ?? {}) as {
      prepare?: boolean
      idle_timeout?: number
    }
    expect(options.prepare).toBe(true)
    // The number the cost model rests on: well under the 300s suspend window
    // and Railway's 600s sleep window, and the same value the cache is
    // configured with — a hardcoded "less than 300" would still pass if this
    // silently became 299.
    const { config } = await import('@/lib/server/config')
    expect(options.idle_timeout).toBe(config.workspacePoolIdleSeconds)
    expect(options.idle_timeout).toBe(45)
    expect(options.idle_timeout).toBeLessThan(300)
    await cache.closeAllWorkspacePools()
  })
})
