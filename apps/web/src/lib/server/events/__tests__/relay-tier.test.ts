/**
 * The relay tier's fleet behaviour.
 *
 * This property lives here rather than in the live harness because it is about
 * what happens when something is WRONG, and a live fleet where everything works
 * cannot show it: a workspace the tier refuses must cost that workspace its relay and
 * nothing else.
 *
 * Where a resolved hook job LANDS is pinned in `relay.test.ts`, against the real
 * drain rather than against this file's stubs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeWorkspace {
  workspaceKey: string
  revision: number
  database: { directUrl: string; pooledUrl: string }
}

const workspace = (id: string): FakeWorkspace => ({
  workspaceKey: id,
  revision: 1,
  database: { directUrl: `postgres://direct/${id}`, pooledUrl: `postgres://pooled/${id}` },
})

interface TierRun {
  workspaceKeys: string[]
  drainedFor: string[]
  poolsOpenedFor: string[]
  /** Every attempt, refused ones included — so a retry storm is countable. */
  poolAttempts: string[]
  attachedFor: string[]
  refusedFor: Array<{ workspaceKey: string; code: string | null }>
  schemaMissingFor: string[]
}

/**
 * Boot the real tier against a stubbed fleet.
 *
 * `refuse` names workspaces whose direct pool throws — the shape a fingerprint
 * mismatch, an unresolvable credential or a dead database all take. The code it
 * throws with decides whether the tier ever tries again, so the fixture carries
 * a real one rather than a bare `Error`.
 */
async function runTier(opts: {
  workspaces: FakeWorkspace[]
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
  const refuseCode = opts.refuseCode ?? 'self_reported_workspace_id_mismatch'
  const missing = new Set(opts.leaderTableMissingFor ?? [])

  vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => true }))
  vi.doMock('@/lib/server/workspaces/mode', () => ({
    isPooledTenancy: () => true,
    POOLED_TENANCY: 'pooled',
  }))
  vi.doMock('@/lib/server/config', () => ({
    config: { isPooledTenancy: true, databaseUrl: 'postgres://direct/single' },
  }))
  vi.doMock('@/lib/server/workspaces/registry', () => ({
    listActiveWorkspaces: async () => ({
      workspaces: opts.workspaces,
      refused: (opts.registryRefused ?? []).map((id) => ({
        workspaceKey: id,
        code: 'invalid_record',
      })),
    }),
  }))
  vi.doMock('@/lib/server/workspaces/pool-cache', () => ({
    resolveWorkspacePassword: async () => 'pw',
    openWorkspaceDirectPool: async (t: FakeWorkspace) => {
      poolAttempts.push(t.workspaceKey)
      if (refuse.has(t.workspaceKey)) {
        throw Object.assign(new Error(`REFUSED [${refuseCode}] ${t.workspaceKey}`), {
          code: refuseCode,
        })
      }
      poolsOpenedFor.push(t.workspaceKey)
      return {
        sql: {},
        db: { __workspace: t.workspaceKey },
        secrets: { secretKey: 'k', storage: null },
        close: async () => {},
      }
    },
  }))
  vi.doMock('@/lib/server/workspaces/workspace-context', () => ({
    // Mirrors the real constructor's contract rather than stubbing it away:
    // secrets are an input it refuses to go without, and never a field on what
    // it hands back. A stub that skipped the refusal would let this suite pass
    // over a relay loop scoped with no resolved SECRET_KEY.
    createWorkspaceScope: (init: Record<string, unknown>) => {
      const secrets = init.secrets as { secretKey?: string } | undefined
      if (!secrets?.secretKey) throw new Error('createWorkspaceScope: no resolved SECRET_KEY')
      const scope = { ...init }
      delete scope.secrets
      return scope
    },
    runWithWorkspaceScope: async (scope: { workspace: FakeWorkspace }, fn: () => unknown) => fn(),
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
      claimRelayLease: async (db: { __workspace?: string }) => {
        if (db.__workspace && missing.has(db.__workspace)) throw new Missing('no table')
        if (opts.claimFails) return null
        drainedFor.push(db.__workspace ?? '__single__')
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
    workspaceKeys: status.workspaces.map((t) => t.workspaceKey).sort(),
    drainedFor: [...new Set(drainedFor)].sort(),
    poolsOpenedFor: poolsOpenedFor.sort(),
    poolAttempts,
    attachedFor: status.workspaces
      .filter((t) => t.attached)
      .map((t) => t.workspaceKey)
      .sort(),
    refusedFor: status.workspaces
      .filter((t) => t.refusedCode !== null)
      .map((t) => ({ workspaceKey: t.workspaceKey, code: t.refusedCode }))
      .sort((a, b) => a.workspaceKey.localeCompare(b.workspaceKey)),
    schemaMissingFor: status.workspaces
      .filter((t) => t.schemaMissing)
      .map((t) => t.workspaceKey)
      .sort(),
  }
}

beforeEach(() => vi.resetModules())

describe('a workspace the tier refuses does not stop the fleet', () => {
  it('a refused pool costs that workspace its relay and nothing else', async () => {
    const run = await runTier({
      workspaces: [workspace('t-a'), workspace('t-bad'), workspace('t-b')],
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
      workspaces: [workspace('t-a'), workspace('t-b')],
      registryRefused: ['t-invalid'],
    })
    expect(run.attachedFor).toEqual(['t-a', 't-b'])
  })

  it('every workspace refused is not an exception — the tier stays up holding nothing', async () => {
    const run = await runTier({ workspaces: [workspace('t-a')], refuse: ['t-a'] })
    expect(run.attachedFor).toEqual([])
    expect(run.poolsOpenedFor).toEqual([])
  })
})

/**
 * The retry storm, and why the loop must stay in the status.
 *
 * Measured on a live fleet: two workspaces refused with `app_secret_no_resolver`
 * were reconnected once per second, one of them the busiest database in the
 * fleet at 70% active for zero work. A refusal no retry can fix has to stop
 * being retried — and has to keep saying so, or the operator loses the only
 * signal that a workspace is not being served.
 */
describe('a refusal no retry can fix stops being retried, and stays visible', () => {
  it('a terminal refusal is attempted once and then left alone', async () => {
    const run = await runTier({
      workspaces: [workspace('t-bad')],
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
      workspaces: [workspace('t-slow')],
      refuse: ['t-slow'],
      // Not in any terminal list: a compute that is still starting.
      refuseCode: 'CONNECT_TIMEOUT',
      settleMs: 3_500,
    })
    expect(run.poolAttempts.length).toBeGreaterThan(1)
  })

  it('a refused workspace is still reported — it is not silently dropped', async () => {
    const run = await runTier({
      workspaces: [workspace('t-a'), workspace('t-bad')],
      refuse: ['t-bad'],
      refuseCode: 'app_secret_no_resolver',
    })
    expect(run.workspaceKeys).toEqual(['t-a', 't-bad'])
    expect(run.refusedFor).toEqual([{ workspaceKey: 't-bad', code: 'app_secret_no_resolver' }])
  })

  it('a database without migration 0256 is skipped, not crash-looped', async () => {
    const run = await runTier({
      workspaces: [workspace('t-a'), workspace('t-b')],
      leaderTableMissingFor: ['t-a'],
    })
    // Both loops exist; only the one that can elect a leader drains.
    expect(run.workspaceKeys).toEqual(['t-a', 't-b'])
    expect(run.drainedFor).toEqual(['t-b'])
    // And it must be RECOGNISED as a missing schema rather than logged as an
    // unexplained failure every poll interval. Without this assertion the two
    // lines above hold either way — the claim throws regardless of whether the
    // tier knows why — which is a test that cannot see the branch it names.
    expect(run.schemaMissingFor).toEqual(['t-a'])
  })

  it('CONTROL: with nothing refused, every workspace drains', async () => {
    // Without this, every assertion above is equally consistent with a tier that
    // drains nothing at all.
    const run = await runTier({ workspaces: [workspace('t-a'), workspace('t-b')] })
    expect(run.drainedFor).toEqual(['t-a', 't-b'])
    expect(run.schemaMissingFor).toEqual([])
  })
})

const DETACH_MS = 1_000
const RESCAN_MS = 5_000
const POLL_MS = 100
const RELAY_WORKSPACE_KEY = 'relay_idle_ws'

const relayEnvKeys = [
  'TENANT_IDLE_DETACH_MS',
  'TENANT_IDLE_RESCAN_MS',
  'RELAY_POLL_INTERVAL_MS',
  'RELAY_FOLLOWER_RETRY_MS',
] as const

interface RelayIdleHandle {
  workspaceKey: string
  noteActivity: (source?: 'request' | 'sweep' | 'script' | 'migration') => void
  nextRescanAt: (now: number) => number
  closes: { listener: number; pool: number }
  status: () => {
    attached: boolean
    detaches: number
    reattaches: number
    lastReattachReason: string | null
    leader: boolean
    drained: number
  }
  stop: () => Promise<void>
}

async function bootRelayIdle(opts?: { claimFails?: boolean }): Promise<RelayIdleHandle> {
  vi.resetModules()
  const saved: Record<string, string | undefined> = {}
  for (const key of relayEnvKeys) saved[key] = process.env[key]
  process.env.TENANT_IDLE_DETACH_MS = String(DETACH_MS)
  process.env.TENANT_IDLE_RESCAN_MS = String(RESCAN_MS)
  process.env.RELAY_POLL_INTERVAL_MS = String(POLL_MS)
  process.env.RELAY_FOLLOWER_RETRY_MS = String(POLL_MS)

  const workspaceKey = RELAY_WORKSPACE_KEY
  const ws = workspace(workspaceKey)
  const closes = { listener: 0, pool: 0 }

  vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => true }))
  vi.doMock('@/lib/server/workspaces/mode', () => ({
    isPooledTenancy: () => true,
    POOLED_TENANCY: 'pooled',
  }))
  vi.doMock('@/lib/server/config', () => ({
    config: { isPooledTenancy: true, databaseUrl: 'postgres://direct/single' },
  }))
  vi.doMock('@/lib/server/workspaces/registry', () => ({
    listActiveWorkspaces: async () => ({ workspaces: [ws], refused: [] }),
  }))
  vi.doMock('@/lib/server/workspaces/pool-cache', () => ({
    resolveWorkspacePassword: async () => 'pw',
    openWorkspaceDirectPool: async () => ({
      sql: {},
      db: { __workspace: workspaceKey },
      secrets: { secretKey: 'k', storage: null },
      close: async () => {
        closes.pool += 1
      },
    }),
  }))
  vi.doMock('@/lib/server/workspaces/workspace-context', () => ({
    createWorkspaceScope: (init: Record<string, unknown>) => {
      const secrets = init.secrets as { secretKey?: string } | undefined
      if (!secrets?.secretKey) throw new Error('createWorkspaceScope: no resolved SECRET_KEY')
      const scope = { ...init }
      delete scope.secrets
      return scope
    },
    runWithWorkspaceScope: async (_scope: unknown, fn: () => unknown) => fn(),
  }))
  vi.doMock('@/lib/server/jobs/wake', () => ({
    JOB_WAKE_CHANNEL: 'quackback_job_wake',
    openWakeListener: async () => ({
      close: async () => {
        closes.listener += 1
      },
      verify: async () => true,
    }),
  }))
  vi.doMock('../relay', () => ({
    drainOnce: async () => ({ drained: 0, enqueued: 0, skipped: 0, failed: 0, lagMsSamples: [] }),
  }))
  vi.doMock('../relay-leader', () => ({
    claimRelayLease: async () =>
      opts?.claimFails
        ? null
        : { owner: 'o', fence: '1', expiresAt: new Date(Date.now() + 30_000) },
    renewRelayLease: async () => ({
      owner: 'o',
      fence: '1',
      expiresAt: new Date(Date.now() + 30_000),
    }),
    releaseRelayLease: async () => true,
    isMissingRelayLeaderTable: () => false,
    relayOwnerId: () => 'owner-1',
  }))
  vi.doMock('../resolvers', () => ({ registerAllResolvers: () => {} }))

  const idle = await import('@/lib/server/workspaces/idle')
  const mod = await import('../relay-tier')
  await mod.startRelayTier()
  await vi.advanceTimersByTimeAsync(0)
  const policy = idle.workspaceIdlePolicy()

  return {
    workspaceKey,
    closes,
    noteActivity: (source = 'request') => idle.noteWorkspaceActivity(workspaceKey, source),
    nextRescanAt: (now: number) => idle.nextRescanAt(now, policy, workspaceKey),
    status: () => {
      const row = mod.getRelayTierStatus().workspaces.find((t) => t.workspaceKey === workspaceKey)
      if (!row) throw new Error('relay loop missing from status')
      return {
        attached: row.attached,
        detaches: row.detaches,
        reattaches: row.reattaches,
        lastReattachReason: row.lastReattachReason,
        leader: row.leader,
        drained: row.drained,
      }
    },
    stop: async () => {
      await mod.stopRelayTier()
      const { __resetQuarantineForTests } = await import('@/lib/server/workspaces/quarantine')
      idle.__resetWorkspaceActivityForTests()
      __resetQuarantineForTests()
      vi.resetModules()
      for (const key of relayEnvKeys) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    },
  }
}

let relayIdle: RelayIdleHandle | null = null

afterEach(async () => {
  if (relayIdle) {
    await relayIdle.stop()
    relayIdle = null
  }
  vi.useRealTimers()
})

describe('a rescan attach that publishes nothing', () => {
  it('detaches a leader on the empty pass instead of waiting detachAfterMs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    relayIdle = await bootRelayIdle()
    expect(relayIdle.status().attached).toBe(true)

    await vi.advanceTimersByTimeAsync(DETACH_MS - 1)
    expect(relayIdle.status().attached).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_MS + 1)
    expect(relayIdle.status().attached).toBe(false)
    expect(relayIdle.status().detaches).toBe(1)
    expect(relayIdle.closes.listener).toBeGreaterThanOrEqual(1)
    expect(relayIdle.closes.pool).toBeGreaterThanOrEqual(1)

    const wait = Math.max(250, relayIdle.nextRescanAt(Date.now()) - Date.now())
    await vi.advanceTimersByTimeAsync(wait)
    expect(relayIdle.status().lastReattachReason).toBe('rescan')
    expect(relayIdle.status().attached).toBe(false)
    expect(relayIdle.status().detaches).toBeGreaterThanOrEqual(2)
  })

  it('detaches a follower that published nothing instead of lingering', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    relayIdle = await bootRelayIdle({ claimFails: true })
    expect(relayIdle.status().attached).toBe(true)
    await vi.advanceTimersByTimeAsync(DETACH_MS + POLL_MS)
    expect(relayIdle.status().detaches).toBe(1)

    const wait = Math.max(250, relayIdle.nextRescanAt(Date.now()) - Date.now())
    await vi.advanceTimersByTimeAsync(wait)
    expect(relayIdle.status().lastReattachReason).toBe('rescan')
    expect(relayIdle.status().attached).toBe(false)
    expect(relayIdle.status().detaches).toBeGreaterThanOrEqual(2)
    expect(relayIdle.status().leader).toBe(false)
  })
})

describe('a signal attach that publishes nothing', () => {
  it('waits detachAfterMs before letting go', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    relayIdle = await bootRelayIdle()
    await vi.advanceTimersByTimeAsync(DETACH_MS + POLL_MS)
    expect(relayIdle.status().attached).toBe(false)

    relayIdle.noteActivity('request')
    await vi.advanceTimersByTimeAsync(0)
    expect(relayIdle.status().attached).toBe(true)
    expect(relayIdle.status().lastReattachReason).toBe('signal')

    await vi.advanceTimersByTimeAsync(DETACH_MS / 2)
    expect(relayIdle.status().attached).toBe(true)
    await vi.advanceTimersByTimeAsync(DETACH_MS / 2 + POLL_MS)
    expect(relayIdle.status().attached).toBe(false)
    expect(relayIdle.status().lastReattachReason).toBe('signal')
  })
})
