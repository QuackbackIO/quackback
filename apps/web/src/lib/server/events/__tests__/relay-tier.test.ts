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
  /** Every attempt, refused ones included — so a retry storm is countable. */
  poolAttempts: string[]
  attachedFor: string[]
  refusedFor: Array<{ tenantId: string; code: string | null }>
  schemaMissingFor: string[]
}

/**
 * Boot the real tier against a stubbed fleet.
 *
 * `refuse` names tenants whose direct pool throws — the shape a fingerprint
 * mismatch, an unresolvable credential or a dead database all take. The code it
 * throws with decides whether the tier ever tries again, so the fixture carries
 * a real one rather than a bare `Error`.
 */
async function runTier(opts: {
  tenants: FakeTenant[]
  registryRefused?: string[]
  refuse?: string[]
  /** Refusal code the stubbed pool throws with. Terminal by default. */
  refuseCode?: string
  claimFails?: boolean
  leaderTableMissingFor?: string[]
  /** Milliseconds to let the tier run before reading its status. */
  settleMs?: number
}): Promise<TierRun> {
  vi.resetModules()
  const drainedFor: string[] = []
  const poolsOpenedFor: string[] = []
  const poolAttempts: string[] = []
  const refuse = new Set(opts.refuse ?? [])
  const refuseCode = opts.refuseCode ?? 'workspace_id_mismatch'
  const missing = new Set(opts.leaderTableMissingFor ?? [])

  vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => true }))
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
      poolAttempts.push(t.tenantId)
      if (refuse.has(t.tenantId)) {
        throw Object.assign(new Error(`REFUSED [${refuseCode}] ${t.tenantId}`), {
          code: refuseCode,
        })
      }
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
    // Mirrors the real constructor's contract rather than stubbing it away:
    // secrets are an input it refuses to go without, and never a field on what
    // it hands back. A stub that skipped the refusal would let this suite pass
    // over a relay loop scoped with no resolved SECRET_KEY.
    createTenantScope: (init: Record<string, unknown>) => {
      const secrets = init.secrets as { secretKey?: string } | undefined
      if (!secrets?.secretKey) throw new Error('createTenantScope: no resolved SECRET_KEY')
      const scope = { ...init }
      delete scope.secrets
      return scope
    },
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
  await new Promise((r) => setTimeout(r, opts.settleMs ?? 25))
  const status = mod.getRelayTierStatus()
  await mod.stopRelayTier()
  vi.resetModules()
  return {
    tenantIds: status.tenants.map((t) => t.tenantId).sort(),
    drainedFor: [...new Set(drainedFor)].sort(),
    poolsOpenedFor: poolsOpenedFor.sort(),
    poolAttempts,
    attachedFor: status.tenants
      .filter((t) => t.attached)
      .map((t) => t.tenantId)
      .sort(),
    refusedFor: status.tenants
      .filter((t) => t.refusedCode !== null)
      .map((t) => ({ tenantId: t.tenantId, code: t.refusedCode }))
      .sort((a, b) => a.tenantId.localeCompare(b.tenantId)),
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
    expect(run.attachedFor).toEqual(['t-a', 't-b'])
    // The property that matters: the refusal is in the MIDDLE of the list, so a
    // pass that threw on the first bad record would have lost `t-b` too. The
    // control is `t-b`, not `t-a`.
    expect(run.attachedFor).toContain('t-b')
  })

  it('a record the registry itself refuses is skipped and the rest still run', async () => {
    const run = await runTier({
      tenants: [tenant('t-a'), tenant('t-b')],
      registryRefused: ['t-invalid'],
    })
    expect(run.attachedFor).toEqual(['t-a', 't-b'])
  })

  it('every tenant refused is not an exception — the tier stays up holding nothing', async () => {
    const run = await runTier({ tenants: [tenant('t-a')], refuse: ['t-a'] })
    expect(run.attachedFor).toEqual([])
    expect(run.poolsOpenedFor).toEqual([])
  })
})

/**
 * The retry storm, and why the loop must stay in the status.
 *
 * Measured on a live fleet: two tenants refused with `app_secret_no_resolver`
 * were reconnected once per second, one of them the busiest database in the
 * fleet at 70% active for zero work. A refusal no retry can fix has to stop
 * being retried — and has to keep saying so, or the operator loses the only
 * signal that a tenant is not being served.
 */
describe('a refusal no retry can fix stops being retried, and stays visible', () => {
  it('a terminal refusal is attempted once and then left alone', async () => {
    const run = await runTier({
      tenants: [tenant('t-bad')],
      refuse: ['t-bad'],
      refuseCode: 'app_secret_no_resolver',
      // Long enough for a 1s-poll loop to have reconnected several times.
      settleMs: 3_500,
    })
    expect(run.poolAttempts).toEqual(['t-bad'])
    expect(run.attachedFor).toEqual([])
  })

  it('a transient refusal is retried, so the two are not the same wait', async () => {
    const run = await runTier({
      tenants: [tenant('t-slow')],
      refuse: ['t-slow'],
      // Not in any terminal list: a compute that is still starting.
      refuseCode: 'CONNECT_TIMEOUT',
      settleMs: 3_500,
    })
    expect(run.poolAttempts.length).toBeGreaterThan(1)
  })

  it('a refused tenant is still reported — it is not silently dropped', async () => {
    const run = await runTier({
      tenants: [tenant('t-a'), tenant('t-bad')],
      refuse: ['t-bad'],
      refuseCode: 'app_secret_no_resolver',
    })
    expect(run.tenantIds).toEqual(['t-a', 't-bad'])
    expect(run.refusedFor).toEqual([{ tenantId: 't-bad', code: 'app_secret_no_resolver' }])
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
