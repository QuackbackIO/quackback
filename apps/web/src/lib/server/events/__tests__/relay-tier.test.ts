/**
 * The relay tier's fleet behaviour.
 *
 * This property lives here rather than in the live harness because it is about
 * what happens when something is WRONG, and a live fleet where everything works
 * cannot show it: a tenant the tier refuses must cost that tenant its relay and
 * nothing else.
 *
 * Where a resolved hook job LANDS is pinned in `relay.test.ts`, against the real
 * drain rather than against this file's stubs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeTenant {
  tenantId: string
  revision: number
  database: { directUrl: string; pooledUrl: string }
}

const tenant = (id: string): FakeTenant => ({
  tenantId: id,
  revision: 1,
  database: { directUrl: `postgres://direct/${id}`, pooledUrl: `postgres://pooled/${id}` },
})

interface TierRun {
  tenantIds: string[]
  drainedFor: string[]
  poolsOpenedFor: string[]
  schemaMissingFor: string[]
}

/**
 * Boot the real tier against a stubbed fleet.
 *
 * `refuse` names tenants whose direct pool throws — the shape a fingerprint
 * mismatch, an unresolvable credential or a dead database all take.
 */
async function runTier(opts: {
  tenants: FakeTenant[]
  registryRefused?: string[]
  refuse?: string[]
  claimFails?: boolean
  leaderTableMissingFor?: string[]
}): Promise<TierRun> {
  vi.resetModules()
  const drainedFor: string[] = []
  const poolsOpenedFor: string[] = []
  const refuse = new Set(opts.refuse ?? [])
  const missing = new Set(opts.leaderTableMissingFor ?? [])

  vi.doMock('@/lib/server/queue/role', () => ({ shouldRunWorkers: () => true }))
  vi.doMock('@/lib/server/tenancy/mode', () => ({
    isPooledTenancy: () => true,
    POOLED_TENANCY: 'pooled',
  }))
  vi.doMock('@/lib/server/config', () => ({
    config: { isPooledTenancy: true, databaseUrl: 'postgres://direct/single' },
  }))
  vi.doMock('@/lib/server/tenancy/registry', () => ({
    listActiveTenants: async () => ({
      tenants: opts.tenants,
      refused: (opts.registryRefused ?? []).map((id) => ({ tenantId: id, code: 'invalid_record' })),
    }),
  }))
  vi.doMock('@/lib/server/tenancy/pool-cache', () => ({
    resolveTenantPassword: async () => 'pw',
    openTenantDirectPool: async (t: FakeTenant) => {
      if (refuse.has(t.tenantId)) throw new Error(`REFUSED [workspace_id_mismatch] ${t.tenantId}`)
      poolsOpenedFor.push(t.tenantId)
      return {
        sql: {},
        db: { __tenant: t.tenantId },
        secrets: { secretKey: 'k', storage: null },
        close: async () => {},
      }
    },
  }))
  vi.doMock('@/lib/server/tenancy/tenant-context', () => ({
    runWithTenantScope: async (scope: { tenant: FakeTenant }, fn: () => unknown) => fn(),
  }))
  vi.doMock('@/lib/server/jobs/wake', () => ({
    JOB_WAKE_CHANNEL: 'quackback_job_wake',
    openWakeListener: async () => ({ close: async () => {}, verify: async () => true }),
  }))
  vi.doMock('../relay', () => ({
    drainOnce: async () => ({ drained: 0, enqueued: 0, skipped: 0, failed: 0, lagMsSamples: [] }),
  }))
  vi.doMock('../relay-leader', () => {
    class Missing extends Error {}
    return {
      claimRelayLease: async (db: { __tenant?: string }) => {
        if (db.__tenant && missing.has(db.__tenant)) throw new Missing('no table')
        if (opts.claimFails) return null
        drainedFor.push(db.__tenant ?? '__single__')
        return { owner: 'o', fence: '1', expiresAt: new Date(Date.now() + 30_000) }
      },
      renewRelayLease: async () => ({
        owner: 'o',
        fence: '1',
        expiresAt: new Date(Date.now() + 30_000),
      }),
      releaseRelayLease: async () => true,
      isMissingRelayLeaderTable: (e: unknown) => e instanceof Missing,
      relayOwnerId: () => 'owner-1',
    }
  })
  vi.doMock('../resolvers', () => ({ registerAllResolvers: () => {} }))

  const mod = await import('../relay-tier')
  await mod.startRelayTier()
  // One event-loop turn so each loop reaches its first lease attempt.
  await new Promise((r) => setTimeout(r, 25))
  const status = mod.getRelayTierStatus()
  await mod.stopRelayTier()
  vi.resetModules()
  return {
    tenantIds: status.tenants.map((t) => t.tenantId).sort(),
    drainedFor: [...new Set(drainedFor)].sort(),
    poolsOpenedFor: poolsOpenedFor.sort(),
    schemaMissingFor: status.tenants
      .filter((t) => t.schemaMissing)
      .map((t) => t.tenantId)
      .sort(),
  }
}

beforeEach(() => vi.resetModules())

describe('a tenant the tier refuses does not stop the fleet', () => {
  it('a refused pool costs that tenant its relay and nothing else', async () => {
    const run = await runTier({
      tenants: [tenant('t-a'), tenant('t-bad'), tenant('t-b')],
      refuse: ['t-bad'],
    })
    expect(run.poolsOpenedFor).toEqual(['t-a', 't-b'])
    expect(run.tenantIds).toEqual(['t-a', 't-b'])
    // The property that matters: the refusal is in the MIDDLE of the list, so a
    // pass that threw on the first bad record would have lost `t-b` too. The
    // control is `t-b`, not `t-a`.
    expect(run.tenantIds).toContain('t-b')
  })

  it('a record the registry itself refuses is skipped and the rest still run', async () => {
    const run = await runTier({
      tenants: [tenant('t-a'), tenant('t-b')],
      registryRefused: ['t-invalid'],
    })
    expect(run.tenantIds).toEqual(['t-a', 't-b'])
  })

  it('every tenant refused is not an exception — the tier stays up with zero loops', async () => {
    const run = await runTier({ tenants: [tenant('t-a')], refuse: ['t-a'] })
    expect(run.tenantIds).toEqual([])
    expect(run.poolsOpenedFor).toEqual([])
  })

  it('a database without migration 0256 is skipped, not crash-looped', async () => {
    const run = await runTier({
      tenants: [tenant('t-a'), tenant('t-b')],
      leaderTableMissingFor: ['t-a'],
    })
    // Both loops exist; only the one that can elect a leader drains.
    expect(run.tenantIds).toEqual(['t-a', 't-b'])
    expect(run.drainedFor).toEqual(['t-b'])
    // And it must be RECOGNISED as a missing schema rather than logged as an
    // unexplained failure every poll interval. Without this assertion the two
    // lines above hold either way — the claim throws regardless of whether the
    // tier knows why — which is a test that cannot see the branch it names.
    expect(run.schemaMissingFor).toEqual(['t-a'])
  })

  it('CONTROL: with nothing refused, every tenant drains', async () => {
    // Without this, every assertion above is equally consistent with a tier that
    // drains nothing at all.
    const run = await runTier({ tenants: [tenant('t-a'), tenant('t-b')] })
    expect(run.drainedFor).toEqual(['t-a', 't-b'])
    expect(run.schemaMissingFor).toEqual([])
  })
})
