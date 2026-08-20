/**
 * One process-level job scheduler: no persistent tenant connection.
 *
 * The heap stores only `{tenantId, wakeAt, generation}`. A tenant
 * database is opened through the verified pooled scope for a drain pass,
 * then released. The next open happens when that tenant's exact
 * deadline arrives, or when after-commit work is signaled.
 *
 * Node timers cannot exceed ~24.8 days; longer deadlines are clamped and
 * re-armed. A stale generation cannot run twice.
 */
import { logger } from '@/lib/server/logger'
import { isPooledTenancy } from '@/lib/server/tenancy/mode'
import { listActiveTenants } from '@/lib/server/tenancy/registry'
import { withTenantScopeById } from '@/lib/server/tenancy/fleet'
import { SINGLE_TENANT_ID } from '@/lib/server/tenancy/after-commit'
import { convertRelayOwnedEvents } from '@/lib/server/events/event-dispatch-queue'
import { earliestTenantDeadline } from './deadlines'
import { earliestPendingJobAt, isMissingJobQueue } from './job-queue'
import {
  awaitPool,
  createJobPool,
  createScheduleState,
  dispatchPass,
  poolSize,
  runJob,
  runMaintenanceTick,
  runScheduleTick,
  runnerConfig,
  type JobPool,
  type RunnerConfig,
  type ScheduleState,
} from './runner'

const log = logger.child({ component: 'job-scheduler' })

/** `setTimeout` argument is a signed 32-bit int. */
export const NODE_MAX_TIMEOUT_MS = 2_147_483_647

const DEFAULT_FANOUT = 8
const DEFAULT_STARTUP_CONCURRENCY = 4
const BAD_TENANT_RETRY_MS = 60_000
const MAX_PASSES = 64

export type SchedulerClock = {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  unref?(handle: unknown): void
}

export function systemClock(): SchedulerClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    unref: (handle) => {
      const t = handle as NodeJS.Timeout
      t.unref?.()
    },
  }
}

export type TenantRun = (tenantId: string) => Promise<Date | null>

interface HeapEntry {
  tenantId: string
  wakeAt: number
  generation: number
}

export interface TenantScheduler {
  signal(tenantId: string): void
  scheduleAt(tenantId: string, wakeAt: number): void
  remove(tenantId: string): void
  peek(): HeapEntry | null
  size(): number
  isRunning(tenantId: string): boolean
  idle(): Promise<void>
  stop(): void
}

export function createTenantScheduler(opts?: {
  clock?: SchedulerClock
  runTenant?: TenantRun
  maxFanout?: number
  /** Drain-loop ceiling. Exposed so the dirty-bit finally path can be tested. */
  maxPasses?: number
  config?: RunnerConfig
}): TenantScheduler {
  const clock = opts?.clock ?? systemClock()
  const runTenant = opts?.runTenant ?? defaultRunTenant
  const maxFanout = opts?.maxFanout ?? DEFAULT_FANOUT
  const maxPasses = opts?.maxPasses ?? MAX_PASSES
  const cfg = opts?.config ?? runnerConfig()

  const entries = new Map<string, HeapEntry>()
  const generations = new Map<string, number>()
  const scheduleStates = new Map<string, ScheduleState>()
  const running = new Set<string>()
  const dirty = new Set<string>()
  const waitQueue: string[] = []
  const inflight = new Set<Promise<void>>()

  let timer: { handle: unknown; tenantId: string; generation: number; wakeAt: number } | null = null
  let stopped = false

  function bump(tenantId: string): number {
    const next = (generations.get(tenantId) ?? 0) + 1
    generations.set(tenantId, next)
    return next
  }

  function peek(): HeapEntry | null {
    let earliest: HeapEntry | null = null
    for (const entry of entries.values()) {
      if (!earliest || entry.wakeAt < earliest.wakeAt) earliest = entry
    }
    return earliest
  }

  function rearmTimer(): void {
    if (stopped) return
    const next = peek()
    if (timer) {
      clock.clearTimeout(timer.handle)
      timer = null
    }
    if (!next) return
    const delay = Math.max(0, Math.min(NODE_MAX_TIMEOUT_MS, next.wakeAt - clock.now()))
    const handle = clock.setTimeout(() => {
      onTimer(next)
    }, delay)
    clock.unref?.(handle)
    timer = {
      handle,
      tenantId: next.tenantId,
      generation: next.generation,
      wakeAt: next.wakeAt,
    }
  }

  function onTimer(armed: HeapEntry): void {
    if (stopped) return
    const current = entries.get(armed.tenantId)
    if (!current || current.generation !== armed.generation) {
      rearmTimer()
      return
    }
    if (current.wakeAt > clock.now()) {
      rearmTimer()
      return
    }
    entries.delete(armed.tenantId)
    rearmTimer()
    kick(armed.tenantId)
  }

  function enqueueWait(tenantId: string): void {
    if (!waitQueue.includes(tenantId)) waitQueue.push(tenantId)
  }

  function kick(tenantId: string): void {
    if (stopped) return
    if (running.has(tenantId)) {
      dirty.add(tenantId)
      return
    }
    if (running.size >= maxFanout) {
      enqueueWait(tenantId)
      return
    }
    void startRun(tenantId)
  }

  function startRun(tenantId: string): void {
    running.add(tenantId)
    const promise = (async () => {
      const wake = { next: null as Date | null }
      try {
        let passes = 0
        do {
          dirty.delete(tenantId)
          wake.next = await runPass(tenantId)
          passes += 1
        } while (dirty.has(tenantId) && passes < maxPasses)
      } catch (err) {
        wake.next = new Date(clock.now() + BAD_TENANT_RETRY_MS)
        log.error({ err, tenant: tenantId }, 'scheduler pass failed')
      } finally {
        running.delete(tenantId)
        // A signal that landed after the last pass (or after the pass budget)
        // is still pending. Kick now; never arm a future deadline over it.
        if (dirty.has(tenantId)) {
          kick(tenantId)
          rearmTimer()
        } else {
          if (wake.next) scheduleAt(tenantId, wake.next.getTime())
          else entries.delete(tenantId)
          const next = waitQueue.shift()
          if (next) kick(next)
          else rearmTimer()
        }
      }
    })()
    inflight.add(promise)
    void promise.finally(() => inflight.delete(promise))
  }

  async function runPass(tenantId: string): Promise<Date | null> {
    if (opts?.runTenant) return runTenant(tenantId)
    return runScopedPass(tenantId, cfg, scheduleState(tenantId))
  }

  function scheduleState(tenantId: string): ScheduleState {
    let state = scheduleStates.get(tenantId)
    if (!state) {
      state = createScheduleState()
      scheduleStates.set(tenantId, state)
    }
    return state
  }

  function signal(tenantId: string): void {
    if (stopped || !tenantId) return
    // Immediate work is kicked now. Leaving a heap entry would also fire
    // the process timer and run the same tenant twice.
    entries.delete(tenantId)
    rearmTimer()
    kick(tenantId)
  }

  function scheduleAt(tenantId: string, wakeAt: number): void {
    if (stopped || !tenantId) return
    const existing = entries.get(tenantId)
    if (existing && existing.wakeAt <= wakeAt) return
    const generation = bump(tenantId)
    entries.set(tenantId, { tenantId, wakeAt, generation })
    rearmTimer()
  }

  function remove(tenantId: string): void {
    entries.delete(tenantId)
    rearmTimer()
  }

  return {
    signal,
    scheduleAt,
    remove,
    peek,
    size: () => entries.size,
    isRunning: (tenantId) => running.has(tenantId),
    async idle() {
      while (inflight.size > 0) await Promise.all([...inflight])
    },
    stop() {
      stopped = true
      if (timer) {
        clock.clearTimeout(timer.handle)
        timer = null
      }
      entries.clear()
      waitQueue.length = 0
    },
  }
}

async function runScopedPass(
  tenantId: string,
  cfg: RunnerConfig,
  state: ScheduleState
): Promise<Date | null> {
  if (tenantId === SINGLE_TENANT_ID || !isPooledTenancy()) {
    return runTenantUntilQuiescent(cfg, state)
  }
  return withTenantScopeById(tenantId, 'queue', () => runTenantUntilQuiescent(cfg, state))
}

async function defaultRunTenant(tenantId: string): Promise<Date | null> {
  return runScopedPass(tenantId, runnerConfig(), createScheduleState())
}

/**
 * Open (already scoped), drain until the queue is quiet, read the next
 * exact deadline, then return so the caller can drop the connection.
 */
export async function runTenantUntilQuiescent(
  cfg: RunnerConfig = runnerConfig(),
  state: ScheduleState = createScheduleState(),
  now = new Date()
): Promise<Date | null> {
  const pool: JobPool = createJobPool()
  let nextEnabledCron: Date | null = null
  let passes = 0

  try {
    try {
      await convertRelayOwnedEvents()
    } catch (err) {
      log.warn({ err }, 'relay-owned event convert failed')
    }
    while (passes < MAX_PASSES) {
      passes += 1
      const scheduled = await runScheduleTick(state, now)
      // Heap only enabled / ungated crons. Gated-off snooze/SLA stay on
      // `earliestTenantDeadline` — their `* * * * *` next slot must not
      // wake the compute every minute.
      if (
        scheduled.nextEnabledSlotAt &&
        (!nextEnabledCron || scheduled.nextEnabledSlotAt < nextEnabledCron)
      ) {
        nextEnabledCron = scheduled.nextEnabledSlotAt
      }
      await runMaintenanceTick(cfg)
      const dispatched = await dispatchPass({ pool, config: cfg, run: runJob })
      if (dispatched.claimed === 0 && poolSize(pool) === 0) {
        if (dispatched.saturated) {
          await awaitPool(pool)
          continue
        }
        break
      }
      if (poolSize(pool) > 0) await awaitPool(pool)
    }
    await awaitPool(pool)
  } catch (err) {
    if (isMissingJobQueue(err)) return nextEnabledCron
    throw err
  }

  const pending = await earliestPendingJobAt().catch((err) => {
    if (isMissingJobQueue(err)) return null
    throw err
  })
  const deadline = await earliestTenantDeadline(now.getTime())
  return minDate(pending, deadline, nextEnabledCron)
}

function minDate(...values: Array<Date | null | undefined>): Date | null {
  let earliest: Date | null = null
  for (const value of values) {
    if (!value) continue
    if (!earliest || value < earliest) earliest = value
  }
  return earliest
}

export function wakeMode(env: NodeJS.ProcessEnv = process.env): 'listener' | 'scheduler' | 'both' {
  const raw = env.QUACKBACK_WAKE_MODE?.trim()
  if (raw === 'scheduler' || raw === 'both' || raw === 'listener') return raw
  return 'listener'
}

let processScheduler: TenantScheduler | null = null

export function getProcessScheduler(): TenantScheduler | null {
  return processScheduler
}

export async function startTenantScheduler(opts?: {
  clock?: SchedulerClock
  runTenant?: TenantRun
  recover?: boolean
}): Promise<TenantScheduler> {
  if (processScheduler) return processScheduler
  const scheduler = createTenantScheduler(opts)
  processScheduler = scheduler

  if (opts?.recover !== false) {
    await recoverPendingWork(scheduler)
  }
  log.info({ wake_mode: wakeMode() }, 'tenant scheduler started')
  return scheduler
}

export async function stopTenantScheduler(): Promise<void> {
  processScheduler?.stop()
  processScheduler = null
}

/**
 * Reconstruct pending work after a process start.
 *
 * This is the only fleet scan. It is not repeated on an interval. At the
 * current fleet size (under 20 tenants) a bounded concurrent pass is
 * cheaper than a second durable scheduler. Revisit when startup exceeds
 * ~30s or the active fleet exceeds ~200 tenants.
 */
export async function recoverPendingWork(
  scheduler: TenantScheduler,
  list: () => Promise<string[]> = listRecoverableTenants,
  concurrency = envInt('JOB_STARTUP_SCAN_CONCURRENCY', DEFAULT_STARTUP_CONCURRENCY, 1, 32)
): Promise<void> {
  const keys = await list()
  log.info({ tenants: keys.length, concurrency }, 'scheduler startup recovery')
  let index = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, keys.length || 1)) }, () =>
    (async () => {
      while (index < keys.length) {
        const key = keys[index]
        index += 1
        scheduler.signal(key)
      }
    })()
  )
  await Promise.all(workers)
  await scheduler.idle()
}

async function listRecoverableTenants(): Promise<string[]> {
  if (!isPooledTenancy()) return [SINGLE_TENANT_ID]
  const { tenants } = await listActiveTenants()
  return tenants.map((w) => w.tenantId)
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) return fallback
  return n
}
