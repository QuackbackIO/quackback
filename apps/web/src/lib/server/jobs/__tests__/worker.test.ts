/**
 * The job worker starts one always-on poll loop per workspace and does not
 * detach it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const POLL_MS = 50
const REAP_MS = POLL_MS * 4
const PRUNE_MS = REAP_MS * 10
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
  /** `prune` flag of every `runMaintenanceTick` call, in order, when provided. */
  maintenance?: boolean[]
  dispatchCalls?: number
  startByIdCalls?: number
  /** Options of every `createScheduleState` call, in order, when provided. */
  scheduleStates?: unknown[]
  pollMs?: number
  reapMs?: number
  /** Schedule slots fall on multiples of this, as a cron's do. Unset: no slots. */
  slotEveryMs?: number
  /** Schedule ticks so far, and whether each one throws. */
  ticks?: number
  tickThrows?: boolean
  /** A pending job not yet due runs at this instant (ms). */
  pendingAt?: number
  /** Times the loop asked when the next delayed job is due. */
  lookAheads?: number
  /** `Date.now()` at every dispatch pass, when provided. */
  passTimes?: number[]
  /** Delays applied to successive workspace scope entries. */
  scopeDelaysMs?: number[]
}

interface DormancyPlan {
  /** What `listActiveWorkspaces` returns; mutable so a refresh can see change. */
  workspaces: Array<typeof workspace & { lastActiveAt?: Date | null }>
  /** What the standing-work probe finds in the workspace database. */
  pendingJobAt: Date | null
  deadlineAt: Date | null
  /** Hosted billing configured, and whether queueing last month's usage report inserts a job. */
  hosted?: boolean
  reportInserted?: boolean
  /** Months queued by the dormant usage-report catch-up, per workspace. */
  reportsQueued?: Array<[string, string]>
}

async function bootJobWorker(
  plan: ClaimPlan,
  dormancy?: DormancyPlan,
  opts?: { hangStop?: Promise<void> }
) {
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
    resolveWorkspaceById: async (id: string) => ({
      kind: 'ok',
      workspace: { ...workspace, workspaceKey: id },
    }),
    getControlSql: () => ({}),
  }))
  vi.doMock('../deadlines', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../deadlines')>()),
    earliestWorkspaceDeadline: async () => dormancy?.deadlineAt ?? null,
  }))
  vi.doMock('../job-queue', () => ({
    earliestPendingJobAt: async () => dormancy?.pendingJobAt ?? null,
    nextPendingJobAt: async () => {
      plan.lookAheads = (plan.lookAheads ?? 0) + 1
      // Mirrors the query: only a job not yet due.
      return plan.pendingAt !== undefined && plan.pendingAt > Date.now()
        ? new Date(plan.pendingAt)
        : null
    },
    isMissingJobQueue: () => false,
  }))
  vi.doMock('@/lib/server/domains/billing/usage-report', () => ({
    isHostedBillingConfigured: () => Boolean(dormancy?.hosted),
    previousUtcMonth: () => '2026-08',
    enqueueUsageReport: async ({ month }: { month: string }) => ({
      inserted: Boolean(dormancy?.reportInserted),
      month,
    }),
  }))
  vi.doMock('@/lib/server/workspaces/fleet', () => ({
    withWorkspaceScopeById: async (id: string, _origin: string, body: () => Promise<unknown>) => {
      const delay = plan.scopeDelaysMs?.shift()
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      const out = (await body()) as { month?: string } | undefined
      if (out && typeof out === 'object' && 'month' in out && out.month)
        dormancy?.reportsQueued?.push([id, out.month])
      return out
    },
  }))
  vi.doMock('@/lib/server/events/event-dispatch-queue', () => ({
    convertRelayOwnedEvents: async () => ({ converted: 0, enqueued: 0 }),
  }))
  vi.doMock('../runner', () => ({
    primeJobHandlers: async () => {},
    resetJobHandlers: () => {},
    runnerConfig: () => ({
      pollIntervalMs: plan.pollMs ?? POLL_MS,
      batchSize: 5,
      reapIntervalMs: plan.reapMs ?? REAP_MS,
      pruneIntervalMs: PRUNE_MS,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      maxConcurrency: 4,
    }),
    createJobPool: () => ({}),
    poolSize: () => 0,
    createScheduleState: (opts?: unknown) => {
      plan.scheduleStates?.push(opts)
      return {}
    },
    runScheduleTick: async () => {
      plan.ticks = (plan.ticks ?? 0) + 1
      if (plan.tickThrows) throw new Error('schedule tick failed')
      const every = plan.slotEveryMs
      const nextSlotAt = every ? new Date((Math.floor(Date.now() / every) + 1) * every) : null
      return { enqueued: 0, attempted: 0, nextSlotAt }
    },
    runMaintenanceTick: async (_config: unknown, opts: { prune?: boolean } = {}) => {
      plan.maintenance?.push(opts.prune !== false)
      return { requeued: 0, terminated: 0, pruned: 0 }
    },
    dispatchPass: async () => {
      plan.dispatchCalls = (plan.dispatchCalls ?? 0) + 1
      plan.passTimes?.push(Date.now())
      return { claimed: plan.claimed, saturated: true }
    },
    startJobsById: async () => {
      plan.startByIdCalls = (plan.startByIdCalls ?? 0) + 1
      return 0
    },
    runJob: async () => 'succeeded',
    awaitPool: async () => {
      if (opts?.hangStop) await opts.hangStop
    },
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
    wake: async (workspaceKey: string, jobIds: string[] = []) => {
      await mod.handleJobWake({ workspaceKey, jobIds })
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

  it("spreads each workspace's schedule by its own key", async () => {
    // Every loop evaluates the same crons. Keyed by workspace, each loop runs a
    // slot at its own offset instead of the whole fleet starting it at once.
    vi.useFakeTimers()
    const plan: ClaimPlan = { claimed: 0, scheduleStates: [] }
    handle = await bootJobWorker(plan)
    expect(plan.scheduleStates).toEqual([{ spreadKey: WORKSPACE_KEY }])
  })

  it('reaps leases on the reap clock and prunes only on the slower prune clock', async () => {
    // Retention is measured in days; pruning on every reap tick scans every
    // workspace's terminal rows for nothing. Only the first tick of each prune
    // window carries the flag.
    vi.useFakeTimers()
    const plan: ClaimPlan = { claimed: 0, maintenance: [] }
    handle = await bootJobWorker(plan)
    expect(plan.maintenance).toEqual([true])

    await vi.advanceTimersByTimeAsync(PRUNE_MS - REAP_MS)
    const withinWindow = plan.maintenance!.slice(1)
    expect(withinWindow.length).toBeGreaterThanOrEqual(2)
    expect(withinWindow.every((prune) => prune === false)).toBe(true)

    await vi.advanceTimersByTimeAsync(REAP_MS * 2)
    expect(plan.maintenance!.filter(Boolean)).toHaveLength(2)
  })

  describe('an idle loop', () => {
    // Every wake is a connection to the workspace's database, and on a pooled
    // fleet one the pooler has closed is a new server process. An idle loop
    // should wake when it has something to do, not on a timer of its own as well.
    const T0 = new Date('2026-01-05T12:00:00.000Z').getTime()

    function idleAt(time: number) {
      vi.useFakeTimers()
      vi.setSystemTime(time)
    }

    it('wakes at its next schedule slot, not at the poll after it', async () => {
      idleAt(T0)
      const plan: ClaimPlan = { claimed: 0, pollMs: 60_000, slotEveryMs: 10_000, passTimes: [] }
      handle = await bootJobWorker(plan)
      expect(plan.passTimes).toEqual([T0])

      await vi.advanceTimersByTimeAsync(9_999)
      expect(plan.passTimes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(plan.passTimes).toEqual([T0, T0 + 10_000])
      expect(plan.ticks).toBe(2)
    })

    it('never sleeps past the poll interval', async () => {
      idleAt(T0)
      const plan: ClaimPlan = { claimed: 0, pollMs: 1_000, slotEveryMs: 60_000, passTimes: [] }
      handle = await bootJobWorker(plan)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(plan.passTimes).toEqual([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000])
    })

    it('wakes when a delayed job falls due, before its slot or poll', async () => {
      idleAt(T0)
      const plan: ClaimPlan = {
        claimed: 0,
        pollMs: 60_000,
        slotEveryMs: 60_000,
        pendingAt: T0 + 3_000,
        passTimes: [],
      }
      handle = await bootJobWorker(plan)
      await vi.advanceTimersByTimeAsync(2_999)
      expect(plan.passTimes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(plan.passTimes).toEqual([T0, T0 + 3_000])
    })

    it('does not ask about delayed jobs when it polls often anyway', async () => {
      idleAt(T0)
      const plan: ClaimPlan = {
        claimed: 0,
        pollMs: 1_000,
        slotEveryMs: 60_000,
        pendingAt: T0 + 30_000,
        lookAheads: 0,
      }
      handle = await bootJobWorker(plan)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(plan.dispatchCalls).toBeGreaterThanOrEqual(5)
      expect(plan.lookAheads).toBe(0)
    })

    it('backs off the poll interval after a failed pass instead of retrying at once', async () => {
      // A pass that throws before its tick moved the slot forward leaves the slot
      // in the past. Sleeping until it would retry a failing database in a loop.
      idleAt(T0)
      const plan: ClaimPlan = { claimed: 0, pollMs: 5_000, slotEveryMs: 60_000, tickThrows: true }
      handle = await bootJobWorker(plan)
      expect(plan.ticks).toBe(1)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(plan.ticks).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(plan.ticks).toBe(2)
    })

    it("reaps on every slot's pass, even after a pass that started late", async () => {
      idleAt(T0)
      const plan: ClaimPlan = {
        claimed: 0,
        pollMs: 60_000,
        reapMs: 60_000,
        slotEveryMs: 60_000,
        maintenance: [],
        // The first pass opens its scope 300ms late; the next starts on its slot.
        scopeDelaysMs: [300],
        passTimes: [],
      }
      handle = await bootJobWorker(plan)
      await vi.advanceTimersByTimeAsync(300)
      expect(plan.maintenance).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(60_000 - 300)
      expect(plan.passTimes).toEqual([T0 + 300, T0 + 60_000])
      expect(plan.maintenance).toHaveLength(2)
    })
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

    it('keeps an idle workspace awake while work falls due within a refresh pass', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: new Date(Date.now() + 30_000),
        deadlineAt: null,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.loops()).toEqual(['ws_idle'])
      expect(handle.dormant()).toBe(0)

      // The job drains; a deadline due inside the window still holds it.
      dormancy.pendingJobAt = null
      dormancy.deadlineAt = new Date(Date.now() + 30_000)
      await handle.refresh()
      expect(handle.loops()).toEqual(['ws_idle'])

      // Nothing left: the next refresh parks it.
      dormancy.deadlineAt = null
      await handle.refresh()
      expect(handle.loops()).toEqual([])
      expect(handle.dormant()).toBe(1)
    })

    it('parks a workspace whose next deadline is days away instead of keeping it awake', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: null,
        deadlineAt: new Date(Date.now() + 3 * 24 * HOUR),
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.loops()).toEqual([])
      expect(handle.dormant()).toBe(1)

      await handle.refresh()
      expect(handle.loops()).toEqual([])
      expect(handle.dormant()).toBe(1)
    })

    it('parks a workspace whose next delayed job is hours away instead of keeping it awake', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: new Date(Date.now() + 2 * HOUR),
        deadlineAt: null,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.loops()).toEqual([])
      expect(handle.dormant()).toBe(1)
    })

    it('wakes a parked workspace in the refresh pass before its deadline falls due', async () => {
      vi.useFakeTimers()
      const deadline = new Date(Date.now() + 10 * 60_000)
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: null,
        deadlineAt: deadline,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.dormant()).toBe(1)

      // One minute in, the deadline is nine minutes away: still parked.
      await handle.refresh()
      expect(handle.loops()).toEqual([])
      expect(handle.dormant()).toBe(1)

      // At six minutes the deadline is inside the four-minute wake lead: woken, not yet due.
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(handle.loops()).toEqual(['ws_idle'])
      expect(handle.dormant()).toBe(0)
      expect(Date.now()).toBeLessThan(deadline.getTime())
    })

    it("wakes a parked workspace that has not sent last month's usage report, once", async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: null,
        deadlineAt: null,
        hosted: true,
        reportInserted: true,
        reportsQueued: [],
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      // Parked by the refresh, then woken by the catch-up to run the report.
      expect(dormancy.reportsQueued).toEqual([['ws_idle', '2026-08']])
      expect(handle.loops()).toEqual(['ws_idle'])
      expect(handle.dormant()).toBe(0)

      // The report ran; the next refreshes park it and do not ask again.
      dormancy.reportInserted = false
      await handle.refresh()
      await handle.refresh()
      expect(handle.loops()).toEqual([])
      expect(dormancy.reportsQueued).toEqual([['ws_idle', '2026-08']])
    })

    it('leaves a parked workspace parked when last month is already reported', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: null,
        deadlineAt: null,
        hosted: true,
        reportInserted: false,
        reportsQueued: [],
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(dormancy.reportsQueued).toEqual([['ws_idle', '2026-08']])
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

    it('starts a parked workspace from job-wake without waiting for refresh', async () => {
      vi.useFakeTimers()
      const dormancy: DormancyPlan = {
        workspaces: [idle('ws_idle')],
        pendingJobAt: null,
        deadlineAt: null,
      }
      handle = await bootJobWorker({ claimed: 0 }, dormancy)
      expect(handle.loops()).toEqual([])
      await handle.wake('ws_idle', ['job_01h00000000000000000000000'])
      expect(handle.loops()).toEqual(['ws_idle'])
      expect(handle.dormant()).toBe(0)
    })

    it('deactivates a parked loop before a concurrent wake starts a replacement', async () => {
      vi.useFakeTimers()
      let releaseStop!: () => void
      const hangStop = new Promise<void>((resolve) => {
        releaseStop = resolve
      })
      const dormancy: DormancyPlan = {
        workspaces: [live('ws_idle')],
        pendingJobAt: null,
        deadlineAt: null,
      }
      const plan: ClaimPlan = { claimed: 0, dispatchCalls: 0, startByIdCalls: 0 }
      handle = await bootJobWorker(plan, dormancy, { hangStop })
      expect(handle.loops()).toEqual(['ws_idle'])

      dormancy.workspaces = [idle('ws_idle')]
      try {
        vi.advanceTimersByTime(60_000)
        await vi.advanceTimersByTimeAsync(0)
        await vi.waitFor(() => {
          expect(handle!.dormant()).toBe(1)
        })

        const dispatchesAtPark = plan.dispatchCalls ?? 0
        vi.advanceTimersByTime(POLL_MS * 4)
        await Promise.resolve()
        expect(plan.dispatchCalls).toBe(dispatchesAtPark)

        await handle.wake('ws_idle', ['job_01h00000000000000000000000'])
        expect(handle.loops()).toEqual(['ws_idle'])
        expect(handle.dormant()).toBe(0)
        expect(plan.startByIdCalls).toBe(1)
      } finally {
        releaseStop()
      }
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
