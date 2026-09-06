/**
 * The job worker starts one always-on poll loop per workspace and does not
 * detach it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const POLL_MS = 50
const WORKSPACE_KEY = 'job_loop_ws'

const workspace = {
  workspaceKey: WORKSPACE_KEY,
  revision: 1,
  database: {
    directUrl: `postgres://direct/${WORKSPACE_KEY}`,
    pooledUrl: `postgres://pooled/${WORKSPACE_KEY}`,
  },
}

interface ClaimPlan {
  claimed: number
}

interface DormancyPlan {
  /** What `listActiveWorkspaces` returns; mutable so a refresh can see change. */
  workspaces: Array<typeof workspace & { lastActiveAt?: Date | null }>
  /** What the standing-work probe finds in the workspace database. */
  pendingJobAt: Date | null
  deadlineAt: Date | null
}

async function bootJobWorker(plan: ClaimPlan, dormancy?: DormancyPlan) {
  vi.resetModules()
  const savedPoll = process.env.JOB_POLL_INTERVAL_MS
  process.env.JOB_POLL_INTERVAL_MS = String(POLL_MS)

  vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => true }))
  vi.doMock('@/lib/server/config', () => ({
    config: {
      isPooledTenancy: true,
      databaseUrl: 'postgres://direct/single',
      workspaceDormantAfterHours: 168,
    },
  }))
  vi.doMock('@/lib/server/workspaces/registry', () => ({
    listActiveWorkspaces: async () => ({
      workspaces: dormancy ? dormancy.workspaces : [workspace],
      refused: [],
    }),
    getControlSql: () => ({}),
  }))
  vi.doMock('@/lib/server/workspaces/fleet', () => ({
    withWorkspaceScopeById: async (_id: string, _origin: string, body: () => Promise<unknown>) =>
      body(),
  }))
  vi.doMock('../deadlines', () => ({
    earliestWorkspaceDeadline: async () => dormancy?.deadlineAt ?? null,
  }))
  vi.doMock('../job-queue', () => ({
    earliestPendingJobAt: async () => dormancy?.pendingJobAt ?? null,
    isMissingJobQueue: () => false,
  }))
  vi.doMock('@/lib/server/events/event-dispatch-queue', () => ({
    convertRelayOwnedEvents: async () => ({ converted: 0, enqueued: 0 }),
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
    createJobPool: () => ({}),
    poolSize: () => 0,
    createScheduleState: () => ({}),
    runScheduleTick: async () => ({ enqueued: 0, attempted: 0, nextSlotAt: null }),
    runMaintenanceTick: async () => ({ requeued: 0, terminated: 0 }),
    dispatchPass: async () => ({ claimed: plan.claimed, saturated: true }),
    runJob: async () => 'succeeded',
    awaitPool: async () => {},
  }))

  const mod = await import('../worker')
  await mod.startJobWorker()
  await vi.advanceTimersByTimeAsync(0)

  return {
    status: () => {
      const row = mod.getJobWorkerStatus().workspaces.find((t) => t.workspaceKey === WORKSPACE_KEY)
      if (!row) throw new Error('job loop missing from status')
      return row
    },
    loops: () =>
      mod
        .getJobWorkerStatus()
        .workspaces.map((t) => t.workspaceKey)
        .sort(),
    dormant: () => mod.getJobWorkerStatus().dormant,
    /** Advance past the registry refresh so the loop set is reconciled once. */
    refresh: async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    },
    stop: async () => {
      await mod.stopJobWorker()
      vi.resetModules()
      if (savedPoll === undefined) delete process.env.JOB_POLL_INTERVAL_MS
      else process.env.JOB_POLL_INTERVAL_MS = savedPoll
    },
  }
}

let handle: Awaited<ReturnType<typeof bootJobWorker>> | null = null

afterEach(async () => {
  if (handle) {
    await handle.stop()
    handle = null
  }
  vi.useRealTimers()
})

describe('pooled job worker', () => {
  it('starts a loop per workspace and keeps polling', async () => {
    vi.useFakeTimers()
    const plan = { claimed: 0 }
    handle = await bootJobWorker(plan)
    expect(handle.status().passes).toBeGreaterThanOrEqual(1)

    const before = handle.status().passes
    plan.claimed = 2
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(handle.status().passes).toBeGreaterThan(before)
    expect(handle.status().claimed).toBeGreaterThanOrEqual(2)
  })

  describe('dormancy', () => {
    const HOUR = 3_600_000
    const idle = (key: string) => ({
      ...workspace,
      workspaceKey: key,
      lastActiveAt: new Date(Date.now() - 200 * HOUR),
    })
    const live = (key: string) => ({
      ...workspace,
      workspaceKey: key,
      lastActiveAt: new Date(Date.now() - HOUR),
    })

    it('parks idle workspaces with nothing pending and runs loops for the rest', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [
          live(WORKSPACE_KEY),
          idle('ws_idle'),
          { ...workspace, workspaceKey: 'ws_unstamped' },
        ],
        pendingJobAt: null,
        deadlineAt: null,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.loops()).toEqual([WORKSPACE_KEY, 'ws_unstamped'])
      expect(handle.dormant()).toBe(1)
    })

    it('keeps an idle workspace awake while it has a pending job or a deadline', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: new Date(Date.now() + HOUR),
        deadlineAt: null,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.loops()).toEqual(['ws_idle'])
      expect(handle.dormant()).toBe(0)

      // The job drains; a deadline still holds it.
      dormancy.pendingJobAt = null
      dormancy.deadlineAt = new Date(Date.now() + 2 * HOUR)
      await handle.refresh()
      expect(handle.loops()).toEqual(['ws_idle'])

      // Nothing left: the next refresh parks it.
      dormancy.deadlineAt = null
      await handle.refresh()
      expect(handle.loops()).toEqual([])
      expect(handle.dormant()).toBe(1)
    })

    it('wakes a parked workspace when a request stamps it', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: null,
        deadlineAt: null,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.loops()).toEqual([])
      expect(handle.dormant()).toBe(1)

      dormancy.workspaces = [live('ws_idle')]
      await handle.refresh()
      expect(handle.loops()).toEqual(['ws_idle'])
      expect(handle.dormant()).toBe(0)
    })

    it('forgets a parked workspace that leaves the registry', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: null,
        deadlineAt: null,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.dormant()).toBe(1)
      dormancy.workspaces = []
      await handle.refresh()
      expect(handle.dormant()).toBe(0)
      expect(handle.loops()).toEqual([])
    })
  })

  it('does not start the job worker on a web replica', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => false }))
    vi.doMock('@/lib/server/config', () => ({
      config: { isPooledTenancy: true, databaseUrl: 'postgres://direct/single' },
    }))
    const mod = await import('../worker')
    await mod.startJobWorker()
    expect(mod.getJobWorkerStatus()).toEqual({ running: false, workspaces: [], dormant: 0 })
    vi.resetModules()
  })
})
