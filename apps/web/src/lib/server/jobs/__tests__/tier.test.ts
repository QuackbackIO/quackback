/**
 * The job tier's idle attach/detach, specifically the two properties WS-1
 * added: a rescan that finds nothing must not sit in the linger, and a
 * signal (or deadline, or boot) still must.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

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

const DETACH_MS = 1_000
const RESCAN_MS = 5_000
const POLL_MS = 100
const WORKSPACE_KEY = 'job_idle_ws'

interface ClaimPlan {
  claimed: number
  enqueued: number
  poolSize: number
  pendingAt: Date | null
}

interface JobTierHandle {
  workspaceKey: string
  plan: ClaimPlan
  listenerCloses: { n: number }
  noteActivity: (source?: 'request' | 'sweep' | 'script' | 'migration') => void
  nextRescanAt: (now: number) => number
  status: () => {
    attached: boolean
    detaches: number
    reattaches: number
    lastReattachReason: string | null
    claimed: number
    passes: number
  }
  stop: () => Promise<void>
}

const envKeys = ['TENANT_IDLE_DETACH_MS', 'TENANT_IDLE_RESCAN_MS', 'JOB_POLL_INTERVAL_MS'] as const

async function bootJobTier(): Promise<JobTierHandle> {
  vi.resetModules()
  const saved: Record<string, string | undefined> = {}
  for (const key of envKeys) saved[key] = process.env[key]
  process.env.TENANT_IDLE_DETACH_MS = String(DETACH_MS)
  process.env.TENANT_IDLE_RESCAN_MS = String(RESCAN_MS)
  process.env.JOB_POLL_INTERVAL_MS = String(POLL_MS)

  const plan: ClaimPlan = { claimed: 0, enqueued: 0, poolSize: 0, pendingAt: null }
  const listenerCloses = { n: 0 }
  const ws = workspace(WORKSPACE_KEY)

  vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => true }))
  vi.doMock('@/lib/server/config', () => ({
    config: { isPooledTenancy: true, databaseUrl: 'postgres://direct/single' },
  }))
  vi.doMock('@/lib/server/workspaces/registry', () => ({
    listActiveWorkspaces: async () => ({ workspaces: [ws], refused: [] }),
  }))
  vi.doMock('@/lib/server/workspaces/fleet', () => ({
    withWorkspaceScopeById: async (_id: string, _origin: string, body: () => Promise<unknown>) =>
      body(),
  }))
  vi.doMock('@/lib/server/workspaces/pool-cache', () => ({
    resolveWorkspacePassword: async () => 'pw',
  }))
  vi.doMock('@/lib/server/jobs/wake', () => ({
    JOB_WAKE_CHANNEL: 'quackback_job_wake',
    openWakeListener: async () => ({
      close: async () => {
        listenerCloses.n += 1
      },
      verify: async () => true,
    }),
  }))
  vi.doMock('@/lib/server/jobs/deadlines', () => ({
    earliestWorkspaceDeadline: async () => null,
  }))
  vi.doMock('@/lib/server/jobs/job-queue', () => ({
    earliestPendingJobAt: async () => plan.pendingAt,
    isMissingJobQueue: () => false,
  }))
  vi.doMock('../runner', () => ({
    primeJobHandlers: async () => {},
    resetJobHandlers: () => {},
    runnerConfig: () => ({
      pollIntervalMs: POLL_MS,
      batchSize: 5,
      reapIntervalMs: 15_000,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      maxConcurrency: 4,
    }),
    wakeDisabled: () => false,
    createJobPool: () => ({}),
    poolSize: () => plan.poolSize,
    createScheduleState: () => ({}),
    runScheduleTick: async () => ({
      enqueued: plan.enqueued,
      attempted: plan.enqueued,
      nextSlotAt: null,
    }),
    runMaintenanceTick: async () => ({ requeued: 0, terminated: 0 }),
    dispatchPass: async () => ({ claimed: plan.claimed, saturated: true }),
    runJob: async () => 'succeeded',
    awaitPool: async () => {},
  }))

  const idle = await import('@/lib/server/workspaces/idle')
  const mod = await import('../tier')
  await mod.startJobTier()
  await vi.advanceTimersByTimeAsync(0)

  const policy = idle.workspaceIdlePolicy()

  return {
    workspaceKey: WORKSPACE_KEY,
    plan,
    listenerCloses,
    noteActivity: (source = 'request') => idle.noteWorkspaceActivity(WORKSPACE_KEY, source),
    nextRescanAt: (now: number) => idle.nextRescanAt(now, policy, WORKSPACE_KEY),
    status: () => {
      const row = mod.getJobTierStatus().workspaces.find((t) => t.workspaceKey === WORKSPACE_KEY)
      if (!row) throw new Error('job loop missing from status')
      return {
        attached: row.attached,
        detaches: row.detaches,
        reattaches: row.reattaches,
        lastReattachReason: row.lastReattachReason,
        claimed: row.claimed,
        passes: row.passes,
      }
    },
    stop: async () => {
      await mod.stopJobTier()
      const { __resetQuarantineForTests } = await import('@/lib/server/workspaces/quarantine')
      idle.__resetWorkspaceActivityForTests()
      __resetQuarantineForTests()
      vi.resetModules()
      for (const key of envKeys) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    },
  }
}

let handle: JobTierHandle | null = null

afterEach(async () => {
  if (handle) {
    await handle.stop()
    handle = null
  }
  vi.useRealTimers()
})

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('a rescan attach that finds no external work', () => {
  it('detaches on the first empty pass instead of waiting detachAfterMs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    handle = await bootJobTier()
    await settle()
    expect(handle.status().attached).toBe(true)

    await vi.advanceTimersByTimeAsync(DETACH_MS - 1)
    expect(handle.status().attached).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_MS + 1)
    expect(handle.status().attached).toBe(false)
    expect(handle.status().detaches).toBe(1)
    expect(handle.listenerCloses.n).toBeGreaterThanOrEqual(1)

    const wait = Math.max(250, handle.nextRescanAt(Date.now()) - Date.now())
    await vi.advanceTimersByTimeAsync(wait)
    await settle()
    expect(handle.status().lastReattachReason).toBe('rescan')
    expect(handle.status().attached).toBe(false)
    expect(handle.status().detaches).toBeGreaterThanOrEqual(2)
  })

  it('still fast-detaches when the only claims were this loop’s own enqueue', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    handle = await bootJobTier()
    await settle()
    await vi.advanceTimersByTimeAsync(DETACH_MS + POLL_MS)
    expect(handle.status().detaches).toBe(1)
    // The first pass after a re-attach always ticks the schedule (`nextScheduleAt`
    // is reset on attach). Claiming only what that tick enqueued is not
    // external work and must not keep the linger open.
    handle.plan.enqueued = 1
    handle.plan.claimed = 1

    const wait = Math.max(250, handle.nextRescanAt(Date.now()) - Date.now())
    await vi.advanceTimersByTimeAsync(wait)
    await settle()
    expect(handle.status().lastReattachReason).toBe('rescan')
    expect(handle.status().attached).toBe(false)
    expect(handle.status().detaches).toBeGreaterThanOrEqual(2)
  })
})

describe('a signal attach that finds no external work', () => {
  it('waits detachAfterMs before letting go', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    handle = await bootJobTier()
    await settle()
    await vi.advanceTimersByTimeAsync(DETACH_MS + POLL_MS)
    expect(handle.status().attached).toBe(false)

    handle.noteActivity('request')
    await settle()
    expect(handle.status().attached).toBe(true)
    expect(handle.status().lastReattachReason).toBe('signal')

    await vi.advanceTimersByTimeAsync(DETACH_MS / 2)
    expect(handle.status().attached).toBe(true)
    await vi.advanceTimersByTimeAsync(DETACH_MS / 2 + POLL_MS)
    expect(handle.status().attached).toBe(false)
    expect(handle.status().lastReattachReason).toBe('signal')
  })
})

describe('a deadline attach that finds no external work', () => {
  it('waits detachAfterMs before letting go', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
    handle = await bootJobTier()
    handle.plan.pendingAt = new Date(Date.now() + DETACH_MS + POLL_MS + 80)
    await settle()
    await vi.advanceTimersByTimeAsync(DETACH_MS + POLL_MS)
    expect(handle.status().attached).toBe(false)

    await vi.advanceTimersByTimeAsync(250)
    await settle()
    expect(handle.status().attached).toBe(true)
    expect(handle.status().lastReattachReason).toBe('deadline')

    await vi.advanceTimersByTimeAsync(DETACH_MS / 2)
    expect(handle.status().attached).toBe(true)
    await vi.advanceTimersByTimeAsync(DETACH_MS / 2 + POLL_MS)
    expect(handle.status().attached).toBe(false)
  })
})
