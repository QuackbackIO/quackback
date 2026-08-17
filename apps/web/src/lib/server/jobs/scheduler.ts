/**
 * One process-level job scheduler: no persistent tenant connection.
 *
 * The heap stores only `{workspaceKey, wakeAt, generation}`. A workspace
 * database is opened through the verified pooled scope for a drain pass,
 * then released. The next open happens when that workspace's exact
 * deadline arrives, or when after-commit work is signaled.
 *
 * Node timers cannot exceed ~24.8 days; longer deadlines are clamped and
 * re-armed. A stale generation cannot run twice.
 */
import { logger } from '@/lib/server/logger'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { listActiveWorkspaces } from '@/lib/server/workspaces/registry'
import { withWorkspaceScopeById } from '@/lib/server/workspaces/fleet'
import { SINGLE_WORKSPACE_KEY } from '@/lib/server/workspaces/after-commit'
import { convertRelayOwnedEvents } from '@/lib/server/events/event-dispatch-queue'
import { earliestWorkspaceDeadline } from './deadlines'
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
const BAD_WORKSPACE_RETRY_MS = 60_000
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

export type WorkspaceRun = (workspaceKey: string) => Promise<Date | null>

interface HeapEntry {
  workspaceKey: string
  wakeAt: number
  generation: number
}

export interface WorkspaceScheduler {
  signal(workspaceKey: string): void
  scheduleAt(workspaceKey: string, wakeAt: number): void
  remove(workspaceKey: string): void
  peek(): HeapEntry | null
  size(): number
  isRunning(workspaceKey: string): boolean
  idle(): Promise<void>
  stop(): void
}

export function createWorkspaceScheduler(opts?: {
  clock?: SchedulerClock
  runWorkspace?: WorkspaceRun
  maxFanout?: number
  /** Drain-loop ceiling. Exposed so the dirty-bit finally path can be tested. */
  maxPasses?: number
  config?: RunnerConfig
}): WorkspaceScheduler {
  const clock = opts?.clock ?? systemClock()
  const runWorkspace = opts?.runWorkspace ?? defaultRunWorkspace
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

  let timer: { handle: unknown; workspaceKey: string; generation: number; wakeAt: number } | null =
    null
  let stopped = false

  function bump(workspaceKey: string): number {
    const next = (generations.get(workspaceKey) ?? 0) + 1
    generations.set(workspaceKey, next)
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
      workspaceKey: next.workspaceKey,
      generation: next.generation,
      wakeAt: next.wakeAt,
    }
  }

  function onTimer(armed: HeapEntry): void {
    if (stopped) return
    const current = entries.get(armed.workspaceKey)
    if (!current || current.generation !== armed.generation) {
      rearmTimer()
      return
    }
    if (current.wakeAt > clock.now()) {
      rearmTimer()
      return
    }
    entries.delete(armed.workspaceKey)
    rearmTimer()
    kick(armed.workspaceKey)
  }

  function enqueueWait(workspaceKey: string): void {
    if (!waitQueue.includes(workspaceKey)) waitQueue.push(workspaceKey)
  }

  function kick(workspaceKey: string): void {
    if (stopped) return
    if (running.has(workspaceKey)) {
      dirty.add(workspaceKey)
      return
    }
    if (running.size >= maxFanout) {
      enqueueWait(workspaceKey)
      return
    }
    void startRun(workspaceKey)
  }

  function startRun(workspaceKey: string): void {
    running.add(workspaceKey)
    const promise = (async () => {
      let nextWake: Date | null = null
      try {
        let passes = 0
        do {
          dirty.delete(workspaceKey)
          nextWake = await runPass(workspaceKey)
          passes += 1
        } while (dirty.has(workspaceKey) && passes < maxPasses)
      } catch (err) {
        log.error({ err, workspace: workspaceKey }, 'scheduler pass failed')
        nextWake = new Date(clock.now() + BAD_WORKSPACE_RETRY_MS)
      } finally {
        running.delete(workspaceKey)
        // A signal that landed after the last pass (or after the pass budget)
        // is still pending. Kick now; never arm a future deadline over it.
        if (dirty.has(workspaceKey)) {
          kick(workspaceKey)
          rearmTimer()
        } else {
          if (nextWake) scheduleAt(workspaceKey, nextWake.getTime())
          else entries.delete(workspaceKey)
          const next = waitQueue.shift()
          if (next) kick(next)
          else rearmTimer()
        }
      }
    })()
    inflight.add(promise)
    void promise.finally(() => inflight.delete(promise))
  }

  async function runPass(workspaceKey: string): Promise<Date | null> {
    if (opts?.runWorkspace) return runWorkspace(workspaceKey)
    return runScopedPass(workspaceKey, cfg, scheduleState(workspaceKey))
  }

  function scheduleState(workspaceKey: string): ScheduleState {
    let state = scheduleStates.get(workspaceKey)
    if (!state) {
      state = createScheduleState()
      scheduleStates.set(workspaceKey, state)
    }
    return state
  }

  function signal(workspaceKey: string): void {
    if (stopped || !workspaceKey) return
    // Immediate work is kicked now. Leaving a heap entry would also fire
    // the process timer and run the same workspace twice.
    entries.delete(workspaceKey)
    rearmTimer()
    kick(workspaceKey)
  }

  function scheduleAt(workspaceKey: string, wakeAt: number): void {
    if (stopped || !workspaceKey) return
    const existing = entries.get(workspaceKey)
    if (existing && existing.wakeAt <= wakeAt) return
    const generation = bump(workspaceKey)
    entries.set(workspaceKey, { workspaceKey, wakeAt, generation })
    rearmTimer()
  }

  function remove(workspaceKey: string): void {
    entries.delete(workspaceKey)
    rearmTimer()
  }

  return {
    signal,
    scheduleAt,
    remove,
    peek,
    size: () => entries.size,
    isRunning: (workspaceKey) => running.has(workspaceKey),
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
  workspaceKey: string,
  cfg: RunnerConfig,
  state: ScheduleState
): Promise<Date | null> {
  if (workspaceKey === SINGLE_WORKSPACE_KEY || !isPooledTenancy()) {
    return runWorkspaceUntilQuiescent(cfg, state)
  }
  return withWorkspaceScopeById(workspaceKey, 'queue', () => runWorkspaceUntilQuiescent(cfg, state))
}

async function defaultRunWorkspace(workspaceKey: string): Promise<Date | null> {
  return runScopedPass(workspaceKey, runnerConfig(), createScheduleState())
}

/**
 * Open (already scoped), drain until the queue is quiet, read the next
 * exact deadline, then return so the caller can drop the connection.
 */
export async function runWorkspaceUntilQuiescent(
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
      // `earliestWorkspaceDeadline` — their `* * * * *` next slot must not
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
  const deadline = await earliestWorkspaceDeadline(now.getTime())
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

let processScheduler: WorkspaceScheduler | null = null

export function getProcessScheduler(): WorkspaceScheduler | null {
  return processScheduler
}

export async function startWorkspaceScheduler(opts?: {
  clock?: SchedulerClock
  runWorkspace?: WorkspaceRun
  recover?: boolean
}): Promise<WorkspaceScheduler> {
  if (processScheduler) return processScheduler
  const scheduler = createWorkspaceScheduler(opts)
  processScheduler = scheduler

  if (opts?.recover !== false) {
    await recoverPendingWork(scheduler)
  }
  log.info({ wake_mode: wakeMode() }, 'workspace scheduler started')
  return scheduler
}

export async function stopWorkspaceScheduler(): Promise<void> {
  processScheduler?.stop()
  processScheduler = null
}

/**
 * Reconstruct pending work after a process start.
 *
 * This is the only fleet scan. It is not repeated on an interval. At the
 * current fleet size (under 20 workspaces) a bounded concurrent pass is
 * cheaper than a second durable scheduler. Revisit when startup exceeds
 * ~30s or the active fleet exceeds ~200 workspaces.
 */
export async function recoverPendingWork(
  scheduler: WorkspaceScheduler,
  list: () => Promise<string[]> = listRecoverableWorkspaces,
  concurrency = envInt('JOB_STARTUP_SCAN_CONCURRENCY', DEFAULT_STARTUP_CONCURRENCY, 1, 32)
): Promise<void> {
  const keys = await list()
  log.info({ workspaces: keys.length, concurrency }, 'scheduler startup recovery')
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

async function listRecoverableWorkspaces(): Promise<string[]> {
  if (!isPooledTenancy()) return [SINGLE_WORKSPACE_KEY]
  const { workspaces } = await listActiveWorkspaces()
  return workspaces.map((w) => w.workspaceKey)
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) return fallback
  return n
}
