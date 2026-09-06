/**
 * The job worker — one always-on poll loop per workspace.
 *
 * `runner.ts` decides what happens inside a workspace scope. This file owns
 * the scopes, the timers, and the workspace list. There is no LISTEN doorbell
 * and no idle-detach: compute and Postgres stay up, so each loop just polls.
 *
 * Under `QUACKBACK_TENANCY=single` there is one loop, no scope, and
 * `DATABASE_URL`. Under pooled tenancy the worker (`QUACKBACK_ROLE=worker` or
 * `all`) starts a loop per active registry workspace. `QUACKBACK_ROLE=web`
 * is a no-op so HTTP replicas stay producer-only.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { runWithLogContext } from '@/lib/server/log-context'
import { shouldRunWorkers } from '@/lib/server/process-role'
import { listActiveWorkspaces, type WorkspaceDescriptor } from '@/lib/server/workspaces/registry'
import { withWorkspaceScopeById } from '@/lib/server/workspaces/fleet'
import {
  isWorkspaceQuarantined,
  noteWorkspaceRefusal,
  noteWorkspaceServed,
  quarantineRetryAt,
  refusalCode,
  reportQuarantine,
} from '@/lib/server/workspaces/quarantine'
import {
  dormantCount,
  isMarkedDormant,
  isPastDormancyThreshold,
  listDormantWorkspaces,
  markDormant,
  markStandingWork,
  resetDormancyMarks,
} from '@/lib/server/workspaces/activity'
import { earliestWorkspaceDeadline } from './deadlines'
import { earliestPendingJobAt, isMissingJobQueue } from './job-queue'
import {
  awaitPool,
  createJobPool,
  createScheduleState,
  dispatchPass,
  poolSize,
  primeJobHandlers,
  resetJobHandlers,
  runJob,
  runMaintenanceTick,
  runScheduleTick,
  runnerConfig,
  type RunnerConfig,
} from './runner'
import { convertRelayOwnedEvents } from '@/lib/server/events/event-dispatch-queue'

const log = logger.child({ component: 'job-worker' })

/** How often the pooled worker re-reads the active workspace list. */
const WORKSPACE_REFRESH_MS = 60_000

/** Sentinel workspace id for a single-workspace install. Never a real workspace id. */
const SINGLE = '__single__'

interface WorkspaceLoop {
  workspaceKey: string
  stop(): Promise<void>
  /** Latest registry view, so a revision change is seen without a restart. */
  observe(workspace: WorkspaceDescriptor): void
}

interface LoopStats {
  passes: number
  claimed: number
  succeeded: number
  failed: number
  scheduled: number
  scheduleAttempts: number
  requeued: number
  terminated: number
  schemaMissing: boolean
  inFlight: number
  peakInFlight: number
  refusedCode: string | null
}

const loops = new Map<string, WorkspaceLoop>()
const stats = new Map<string, LoopStats>()
let running = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function emptyStats(): LoopStats {
  return {
    passes: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    scheduled: 0,
    scheduleAttempts: 0,
    requeued: 0,
    terminated: 0,
    schemaMissing: false,
    inFlight: 0,
    peakInFlight: 0,
    refusedCode: null,
  }
}

/**
 * One workspace's loop: schedule → dispatch → wait the poll interval.
 *
 * The loop does not wait for the work it started. `dispatchPass` hands claimed
 * jobs to a bounded pool and returns, so the next schedule tick happens on
 * time whatever the running jobs are doing.
 */
function startLoop(opts: {
  workspaceKey: string
  config: RunnerConfig
  workspace: WorkspaceDescriptor | null
  scoped: <T>(body: () => Promise<T>) => Promise<T>
}): WorkspaceLoop {
  const s = emptyStats()
  stats.set(opts.workspaceKey, s)

  let stopped = false
  let waitResolve: (() => void) | null = null
  let nextScheduleAt = 0
  let nextMaintenanceAt = 0
  let descriptor: WorkspaceDescriptor | null = opts.workspace
  const schedule = createScheduleState()
  const pool = createJobPool()

  const nudge = () => {
    const resolve = waitResolve
    waitResolve = null
    resolve?.()
  }

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        waitResolve = null
        resolve()
      }
      const timer = setTimeout(done, ms)
      timer.unref?.()
      waitResolve = done
    })

  const openScope = async (): Promise<boolean> => {
    if (descriptor && isWorkspaceQuarantined(descriptor)) return false
    try {
      await opts.scoped(async () => {})
    } catch (err) {
      const code = refusalCode(err)
      s.refusedCode = code
      if (descriptor) {
        const entry = noteWorkspaceRefusal(descriptor, code, errText(err))
        if (entry.disposition === 'transient') {
          log.warn(
            { workspace_key: opts.workspaceKey, code, attempts: entry.attempts },
            'job loop could not open a scope for this workspace; backing off and retrying'
          )
        }
      } else {
        log.error({ err, workspace_key: opts.workspaceKey }, 'job loop could not open a scope')
      }
      return false
    }
    if (descriptor) noteWorkspaceServed(descriptor.workspaceKey)
    s.refusedCode = null
    return true
  }

  const loop = async () => {
    while (running && !stopped) {
      if (!(await openScope())) {
        if (!running || stopped) break
        const retryAt = descriptor ? quarantineRetryAt(descriptor.workspaceKey) : null
        await wait(retryAt ? Math.max(250, retryAt - Date.now()) : 1_000)
        continue
      }
      try {
        const now = Date.now()
        const result = await opts.scoped(async () => {
          try {
            await convertRelayOwnedEvents()
          } catch (err) {
            log.warn({ err, workspace_key: opts.workspaceKey }, 'relay-owned event convert failed')
          }
          if (now >= nextScheduleAt) {
            const tick = await runScheduleTick(schedule, new Date(now))
            s.scheduled += tick.enqueued
            s.scheduleAttempts += tick.attempted
            nextScheduleAt = tick.nextSlotAt ? tick.nextSlotAt.getTime() : now + 60_000
          }
          if (now >= nextMaintenanceAt) {
            const maintenance = await runMaintenanceTick(opts.config)
            s.requeued += maintenance.requeued
            s.terminated += maintenance.terminated
            nextMaintenanceAt = now + opts.config.reapIntervalMs
          }
          return dispatchPass({
            pool,
            config: opts.config,
            run: (job) => opts.scoped(() => runJob(job)),
            onSettled: (_queue, outcome) => {
              if (outcome === 'succeeded') s.succeeded += 1
              else if (outcome === 'failed') s.failed += 1
              s.inFlight = poolSize(pool)
              nudge()
            },
          })
        })

        s.passes += 1
        s.claimed += result.claimed
        s.inFlight = poolSize(pool)
        if (s.inFlight > s.peakInFlight) s.peakInFlight = s.inFlight
        s.schemaMissing = false
        if (result.claimed > 0 && !result.saturated) continue
      } catch (err) {
        if (isMissingJobQueue(err)) {
          if (!s.schemaMissing) {
            s.schemaMissing = true
            log.warn(
              { workspace_key: opts.workspaceKey },
              'job_queue is absent in this database; skipping this workspace rather than crash-looping'
            )
          }
        } else {
          log.error({ err, workspace_key: opts.workspaceKey }, 'job loop pass failed')
        }
      }
      if (!running || stopped) break
      await wait(opts.config.pollIntervalMs)
    }
  }

  void runWithLogContext(
    { request_id: crypto.randomUUID(), route: 'jobs:worker', workspace_key: opts.workspaceKey },
    loop
  ).catch((err) =>
    log.error(
      { err, event: 'job.loop_exited', workspace_key: opts.workspaceKey },
      'job loop exited'
    )
  )

  log.info(
    {
      event: 'job.loop_started',
      workspace_key: opts.workspaceKey,
      poll_interval_ms: opts.config.pollIntervalMs,
    },
    'job loop started'
  )

  return {
    workspaceKey: opts.workspaceKey,
    observe(workspace) {
      const changed = descriptor !== null && descriptor.revision !== workspace.revision
      descriptor = workspace
      if (changed) nudge()
    },
    async stop() {
      stopped = true
      nudge()
      await awaitPool(pool)
      stats.delete(opts.workspaceKey)
      log.info({ event: 'job.loop_stopped', workspace_key: opts.workspaceKey }, 'job loop stopped')
    },
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function startSingleWorkspaceLoop(cfg: RunnerConfig): void {
  const loop = startLoop({
    workspaceKey: SINGLE,
    config: cfg,
    workspace: null,
    scoped: (body) => body(),
  })
  loops.set(SINGLE, loop)
}

function startWorkspaceLoop(workspace: WorkspaceDescriptor, cfg: RunnerConfig): void {
  const loop = startLoop({
    workspaceKey: workspace.workspaceKey,
    config: cfg,
    workspace,
    scoped: (body) => withWorkspaceScopeById(workspace.workspaceKey, 'queue', body),
  })
  loops.set(workspace.workspaceKey, loop)
}

/**
 * Does this workspace have work a clock will create, whether or not anyone
 * visits? Pending `job_queue` rows (a hook retry, a scheduled publish) or a
 * registered deadline (a snooze, an SLA due-at). Asked inside the workspace's
 * scope, once per refresh, only for workspaces past the idle threshold.
 *
 * Fail-safe direction: a scope that cannot be opened, or a query that throws,
 * answers "yes" — the cost of keeping an idle loop is one loop; the cost of
 * parking a workspace with a due job is the job.
 */
async function probeStandingWork(workspace: WorkspaceDescriptor): Promise<boolean> {
  try {
    return await withWorkspaceScopeById(workspace.workspaceKey, 'queue', async () => {
      const [pendingAt, deadlineAt] = await Promise.all([
        earliestPendingJobAt(),
        earliestWorkspaceDeadline(),
      ])
      return pendingAt !== null || deadlineAt !== null
    })
  } catch (err) {
    if (isMissingJobQueue(err)) return false
    log.warn(
      { err, workspace_key: workspace.workspaceKey },
      'could not probe a dormancy candidate for standing work; keeping its loop'
    )
    return true
  }
}

/**
 * Reconcile the loop set with the registry and the dormancy rule (`activity.ts`).
 *
 * Three states per active registry workspace:
 * - **awake**: recent request, or idle but holding standing work → loop runs;
 * - **dormant**: idle past the threshold with nothing pending → no loop, no
 *   scope, nothing until a request stamps it and the next refresh sees that;
 * - **gone**: no longer active in the registry → loop stopped as before.
 *
 * The standing-work probe is the only cost a dormant candidate pays, and it is
 * paid once per refresh only while the candidate still has a loop (to decide
 * whether to park it) — a workspace already parked is not reopened to ask again.
 * That means a job enqueued into a parked workspace by anything other than a
 * request waits for the wake. Nothing but a request or the worker itself enqueues
 * under pooled tenancy, so that path does not exist while the loop is stopped.
 */
async function refreshWorkspaceLoops(cfg: RunnerConfig): Promise<void> {
  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) {
    log.error({ refused }, 'job worker skipping workspaces with invalid registry records')
  }
  const wanted = new Set(workspaces.map((t) => t.workspaceKey))
  const now = Date.now()

  for (const [workspaceKey, loop] of loops) {
    if (wanted.has(workspaceKey)) continue
    await loop.stop()
    loops.delete(workspaceKey)
    markStandingWork(workspaceKey, false)
  }
  for (const workspaceKey of listDormantWorkspaces()) {
    if (!wanted.has(workspaceKey)) markDormant(workspaceKey, false)
  }

  let parked = 0
  let woke = 0
  for (const workspace of workspaces) {
    const key = workspace.workspaceKey
    const existing = loops.get(key)
    const idle = isPastDormancyThreshold(workspace.lastActiveAt ?? null, now)

    if (!idle) {
      markStandingWork(key, false)
      if (isMarkedDormant(key)) {
        markDormant(key, false)
        woke += 1
        log.info(
          { event: 'workspace.woke', workspace_key: key, last_active_at: workspace.lastActiveAt },
          'dormant workspace saw a request; starting its job loop'
        )
      }
      if (existing) existing.observe(workspace)
      else startWorkspaceLoop(workspace, cfg)
      continue
    }

    // Idle past the threshold. Already parked: leave it alone, cost nothing.
    if (!existing && isMarkedDormant(key)) continue

    // Running (or first sight after a worker boot): ask before parking.
    const standing = await probeStandingWork(workspace)
    markStandingWork(key, standing)
    if (standing) {
      if (existing) existing.observe(workspace)
      else startWorkspaceLoop(workspace, cfg)
      continue
    }

    if (existing) {
      await existing.stop()
      loops.delete(key)
    }
    markDormant(key, true)
    parked += 1
    log.info(
      { event: 'workspace.dormant', workspace_key: key, last_active_at: workspace.lastActiveAt },
      'workspace idle past the dormancy threshold with no standing work; job loop parked'
    )
  }

  if (parked > 0 || woke > 0) {
    log.info(
      { event: 'job.worker_refresh', loops: loops.size, dormant: dormantCount(), parked, woke },
      'job worker loop set changed'
    )
  }

  reportQuarantine()
}

function scheduleWorkspaceRefresh(cfg: RunnerConfig): void {
  if (!running) return
  refreshTimer = setTimeout(() => {
    if (!running) return
    void refreshWorkspaceLoops(cfg)
      .catch((err) => log.error({ err }, 'job worker workspace refresh failed'))
      .finally(() => scheduleWorkspaceRefresh(cfg))
  }, WORKSPACE_REFRESH_MS)
  refreshTimer.unref?.()
}

/**
 * Start the job worker. Runs under `worker` and `all`. A `web` replica is a
 * no-op so HTTP-only scale-out stays producer-only.
 */
export async function startJobWorker(): Promise<void> {
  if (running) return
  if (!shouldRunWorkers()) {
    log.info('QUACKBACK_ROLE=web — job worker not started')
    return
  }
  running = true
  const cfg = runnerConfig()

  await primeJobHandlers()

  if (!config.isPooledTenancy) {
    startSingleWorkspaceLoop(cfg)
    log.info(
      { event: 'job.worker_started', workspaces: 1, poll_interval_ms: cfg.pollIntervalMs },
      'job worker started (single workspace)'
    )
    return
  }

  await refreshWorkspaceLoops(cfg)
  scheduleWorkspaceRefresh(cfg)
  log.info(
    {
      event: 'job.worker_started',
      workspaces: loops.size,
      dormant: dormantCount(),
      dormant_after_hours: config.workspaceDormantAfterHours,
      poll_interval_ms: cfg.pollIntervalMs,
    },
    'job worker started (pooled)'
  )
}

export async function stopJobWorker(): Promise<void> {
  const wasRunning = running
  running = false
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  const all = [...loops.values()]
  loops.clear()
  await Promise.allSettled(all.map((l) => l.stop()))
  resetDormancyMarks()
  resetJobHandlers()
  if (wasRunning) log.info({ event: 'job.worker_stopped' }, 'job worker stopped')
}

export interface JobWorkerStatus {
  running: boolean
  workspaces: Array<{ workspaceKey: string } & LoopStats>
  /** Active registry workspaces with no loop because nobody has visited them. */
  dormant: number
}

export function getJobWorkerStatus(): JobWorkerStatus {
  return {
    running,
    workspaces: [...stats.entries()].map(([workspaceKey, s]) => ({ workspaceKey, ...s })),
    dormant: dormantCount(),
  }
}
