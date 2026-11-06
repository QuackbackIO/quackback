/**
 * The job worker — one always-on poll loop per workspace.
 *
 * `runner.ts` decides what happens inside a workspace scope. This file owns
 * the scopes, the timers, and the workspace list.
 *
 * Happy-path dispatch is start-by-id: after-commit (in-process) or
 * `POST /api/internal/job-wake` (Cloud web → worker) calls `claimById`.
 * The poll loop is the sweeper — correctness when a hint is lost, not how
 * Slack work starts. There is no LISTEN doorbell: PgBouncer does not
 * deliver NOTIFY, and LISTEN cannot start a parked loop.
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
import {
  listActiveWorkspaces,
  resolveWorkspaceById,
  type WorkspaceDescriptor,
} from '@/lib/server/workspaces/registry'
import { onDurableWorkCommitted, type DurableWork } from '@/lib/server/workspaces/after-commit'
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
import { clockWakeLeadMs, earliestWorkspaceDeadline, withinWakeLead } from './deadlines'
import { catchUpDormantUsageReports } from './dormant-usage-report'
import {
  enqueueUsageReport,
  isHostedBillingConfigured,
} from '@/lib/server/domains/billing/usage-report'
import { earliestPendingJobAt, isMissingJobQueue, nextPendingJobAt } from './job-queue'
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
  startJobsById,
  type RunnerConfig,
} from './runner'
import { convertRelayOwnedEvents } from '@/lib/server/events/event-dispatch-queue'

const log = logger.child({ component: 'job-worker' })

/** How often the pooled worker re-reads the active workspace list. */
const WORKSPACE_REFRESH_MS = 60_000

/**
 * How far ahead of its clock-driven work a workspace counts as due, so a parked
 * workspace's loop is running before the cron slot that spends the work. The lead
 * and why it is this long are in `deadlines.ts`.
 */
const WAKE_LEAD_MS = clockWakeLeadMs(WORKSPACE_REFRESH_MS)

/** Sentinel workspace id for a single-workspace install. Never a real workspace id. */
const SINGLE = '__single__'

/**
 * A loop that will be back within this long does not ask when the next delayed
 * job is due. A short poll finds it anyway, and the question would be one more
 * query on every pass of a loop that polls every second.
 */
const LOOKAHEAD_MIN_SLEEP_MS = 5_000

/**
 * When an idle loop next needs its database: its next schedule slot, the next
 * delayed job, or the poll interval, whichever comes first.
 *
 * Under pooled tenancy every wake of every loop is a connection to that
 * workspace's database, and one the pooler has closed is a new server process.
 * A loop that slept the poll interval regardless of its slots woke on its poll
 * and again on its slot. One that sleeps until whichever is due wakes once, at
 * its own offset in the slot (§6 of JOBS.md), so the fleet's connections are
 * spread evenly instead of arriving together.
 */
export function idleWakeAt(input: {
  now: number
  pollIntervalMs: number
  nextScheduleAt: number
  nextPendingAt: number | null
}): number {
  let at = Math.min(input.now + input.pollIntervalMs, input.nextScheduleAt)
  if (input.nextPendingAt !== null) at = Math.min(at, input.nextPendingAt)
  return Math.max(input.now, at)
}

/**
 * How much earlier than its interval a reap may run.
 *
 * A loop that wakes on its schedule slot starts each pass a slot after the last,
 * give or take how late each timer fired. Without slack a one-minute reap,
 * measured from a pass that started a few milliseconds late, is not quite due on
 * the next minute's pass and slips to the one after: it would run every two.
 */
function reapSlackMs(reapIntervalMs: number): number {
  return Math.min(2_000, Math.floor(reapIntervalMs / 10))
}

interface WorkspaceLoop {
  workspaceKey: string
  /**
   * Flip `stopped` and wake the poll wait so this handle will not claim again.
   * Call under `withLoopSet` before `loops.delete`; `stop()` drains the pool.
   */
  deactivate(): void
  stop(): Promise<void>
  /** Latest registry view, so a revision change is seen without a restart. */
  observe(workspace: WorkspaceDescriptor): void
  nudge(): void
  /** True after `deactivate()` — the handle must not claim again. */
  isStopped(): boolean
  inFlightCount(): number
  recentWakeAt: number
  tryStartByIds(jobIds: readonly string[]): Promise<number>
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
/**
 * When each parked workspace next has clock-driven work (ms), as the probe that parked
 * it found. In memory: a restart probes every idle workspace once, which re-learns it.
 */
const scheduledWakes = new Map<string, number>()
let running = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let storedConfig: RunnerConfig | null = null
let unsubscribeCommit: (() => void) | null = null
let loopSetTail: Promise<void> = Promise.resolve()

/** Serialize map get/set/delete only — never hold this across probes or awaitPool. */
function withLoopSet<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = loopSetTail.then(fn, fn)
  loopSetTail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

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
 * One workspace's loop: schedule → dispatch → sleep until the next slot, the
 * next delayed job or the poll interval, whichever is first (`idleWakeAt`).
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
  let pendingNudge = false
  let nextScheduleAt = 0
  let nextMaintenanceAt = 0
  let nextPruneAt = 0
  let descriptor: WorkspaceDescriptor | null = opts.workspace
  // A pooled loop spreads its slots by its workspace key; a single install runs
  // on the minute.
  const schedule = createScheduleState({ spreadKey: opts.workspace ? opts.workspaceKey : null })
  const pool = createJobPool()
  const handle: WorkspaceLoop = {
    workspaceKey: opts.workspaceKey,
    recentWakeAt: 0,
    nudge() {
      pendingNudge = true
      this.recentWakeAt = Date.now()
      const resolve = waitResolve
      waitResolve = null
      resolve?.()
    },
    inFlightCount() {
      return poolSize(pool)
    },
    observe(workspace) {
      const changed = descriptor !== null && descriptor.revision !== workspace.revision
      descriptor = workspace
      if (changed) handle.nudge()
    },
    async tryStartByIds(jobIds) {
      if (jobIds.length === 0 || stopped) return 0
      return opts.scoped(async () => {
        if (stopped) return 0
        return startJobsById({
          pool,
          config: opts.config,
          jobIds,
          run: (job) => opts.scoped(() => runJob(job)),
          onSettled: (_queue, outcome) => {
            if (outcome === 'succeeded') s.succeeded += 1
            else if (outcome === 'failed') s.failed += 1
            s.inFlight = poolSize(pool)
            handle.nudge()
          },
        })
      })
    },
    deactivate() {
      if (stopped) return
      stopped = true
      handle.nudge()
    },
    isStopped() {
      return stopped
    },
    async stop() {
      handle.deactivate()
      await awaitPool(pool)
      const current = loops.get(opts.workspaceKey)
      if (!current || current === handle) stats.delete(opts.workspaceKey)
      log.info({ event: 'job.loop_stopped', workspace_key: opts.workspaceKey }, 'job loop stopped')
    },
  }

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (pendingNudge) {
        pendingNudge = false
        resolve()
        return
      }
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
      // Null after a pass that failed: back off the whole poll interval rather
      // than sleep to a slot the failed pass may not have moved past.
      let wakeAt: number | null = null
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
            const prune = now >= nextPruneAt
            const maintenance = await runMaintenanceTick(opts.config, { prune })
            s.requeued += maintenance.requeued
            s.terminated += maintenance.terminated
            nextMaintenanceAt =
              now + opts.config.reapIntervalMs - reapSlackMs(opts.config.reapIntervalMs)
            if (prune) nextPruneAt = now + opts.config.pruneIntervalMs
          }
          if (stopped) return { claimed: 0, saturated: true, nextPendingAt: null }
          const dispatched = await dispatchPass({
            pool,
            config: opts.config,
            run: (job) => opts.scoped(() => runJob(job)),
            onSettled: (_queue, outcome) => {
              if (outcome === 'succeeded') s.succeeded += 1
              else if (outcome === 'failed') s.failed += 1
              s.inFlight = poolSize(pool)
              handle.nudge()
            },
          })
          // Asked on the connection this pass already holds, and only by a loop
          // about to sleep long enough for a delayed job to fall due meanwhile.
          const sleepsFor =
            Math.min(nextScheduleAt, Date.now() + opts.config.pollIntervalMs) - Date.now()
          const lookAhead =
            (dispatched.claimed === 0 || dispatched.saturated) && sleepsFor > LOOKAHEAD_MIN_SLEEP_MS
          const nextPendingAt = lookAhead ? await nextPendingJobAt() : null
          return { ...dispatched, nextPendingAt }
        })
        if (!running || stopped) break

        s.passes += 1
        s.claimed += result.claimed
        s.inFlight = poolSize(pool)
        if (s.inFlight > s.peakInFlight) s.peakInFlight = s.inFlight
        s.schemaMissing = false
        if (result.claimed > 0 && !result.saturated) continue
        if (pendingNudge) {
          pendingNudge = false
          continue
        }
        wakeAt = idleWakeAt({
          now: Date.now(),
          pollIntervalMs: opts.config.pollIntervalMs,
          nextScheduleAt,
          nextPendingAt: result.nextPendingAt?.getTime() ?? null,
        })
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
      await wait(wakeAt === null ? opts.config.pollIntervalMs : Math.max(0, wakeAt - Date.now()))
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

  return handle
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

/** What an idle workspace's clock-driven work looks like from the worker. */
interface ClockWork {
  /** Work is due now or within `WAKE_LEAD_MS`: the loop must stay awake for it. */
  standing: boolean
  /** When the workspace's next clock-driven work falls due (ms), or null for none. */
  nextAt: number | null
}

/**
 * Does this workspace have work a clock will create, whether or not anyone
 * visits? Pending `job_queue` rows (a hook retry, a scheduled publish) and
 * registered deadlines (a snooze, an SLA due-at, a Jira webhook refresh). Asked
 * inside the workspace's scope, once per refresh, only for workspaces past the
 * idle threshold.
 *
 * Only work inside `WAKE_LEAD_MS` keeps the loop awake. Later work is still
 * reported, as the instant the parked workspace is woken for, so a workspace
 * whose next refresh is days away parks now and is woken before it falls due
 * rather than polling until then.
 *
 * Fail-safe direction: a scope that cannot be opened, or a query that throws,
 * answers "standing" — the cost of keeping an idle loop is one loop; the cost of
 * parking a workspace with a due job is the job.
 */
async function probeClockWork(workspace: WorkspaceDescriptor, now: number): Promise<ClockWork> {
  try {
    return await withWorkspaceScopeById(workspace.workspaceKey, 'queue', async () => {
      const [pendingAt, deadlineAt] = await Promise.all([
        earliestPendingJobAt(),
        earliestWorkspaceDeadline(now),
      ])
      return clockWorkAt([pendingAt, deadlineAt], now)
    })
  } catch (err) {
    if (isMissingJobQueue(err)) return { standing: false, nextAt: null }
    log.warn(
      { err, workspace_key: workspace.workspaceKey },
      'could not probe a dormancy candidate for clock-driven work; keeping its loop'
    )
    return { standing: true, nextAt: null }
  }
}

function clockWorkAt(instants: ReadonlyArray<Date | null>, now: number): ClockWork {
  let nextAt: number | null = null
  for (const at of instants) {
    if (at === null) continue
    if (nextAt === null || at.getTime() < nextAt) nextAt = at.getTime()
  }
  return { standing: nextAt !== null && withinWakeLead(nextAt, now, WAKE_LEAD_MS), nextAt }
}

/** Is a parked workspace's clock-driven work due inside the refresh pass that is asking? */
function clockWakeDue(workspaceKey: string, now: number): boolean {
  const at = scheduledWakes.get(workspaceKey)
  return at !== undefined && withinWakeLead(at, now, WAKE_LEAD_MS)
}

/**
 * Start a parked workspace's loop because its clock-driven work falls due within
 * the refresh pass. The loop's next probe either keeps it awake for work now due,
 * or parks it again at the instant of its next work.
 */
function wakeForClockWork(
  workspace: WorkspaceDescriptor,
  cfg: RunnerConfig,
  now: number
): Promise<boolean> {
  const key = workspace.workspaceKey
  return withLoopSet(() => {
    if (loops.get(key) || !isMarkedDormant(key) || !clockWakeDue(key, now)) return false
    scheduledWakes.delete(key)
    markDormant(key, false)
    markStandingWork(key, true)
    startWorkspaceLoop(workspace, cfg)
    log.info(
      { event: 'workspace.woke', workspace_key: key, via: 'clock' },
      'dormant workspace woken for clock-driven work'
    )
    return true
  })
}

/**
 * Reconcile the loop set with the registry and the dormancy rule (`activity.ts`).
 *
 * Three states per active registry workspace:
 * - **awake**: recent request, or idle but holding work due within a refresh pass
 *   → loop runs;
 * - **dormant**: idle past the threshold with no work due soon → no loop, no
 *   scope. It is woken by a request (the next refresh sees the stamp), by a
 *   job-wake, or by a refresh pass that finds its next clock-driven work due;
 * - **gone**: no longer active in the registry → loop stopped as before.
 *
 * The standing-work probe is the only cost a dormant candidate pays, and it is
 * paid once per refresh only while the candidate still has a loop (to decide
 * whether to park it) — a workspace already parked is not reopened to ask again.
 * Parking records when the workspace's clock-driven work next falls due, so the
 * refresh can wake it without opening its scope.
 * A job-wake HTTP call starts a parked loop immediately; refresh only
 * reconciles. Park deactivates and deletes the handle from `loops` under
 * the lock, then `stop()`s outside. A concurrent wake sees missing and
 * starts; the old loop will not claim again.
 */
async function refreshWorkspaceLoops(cfg: RunnerConfig): Promise<void> {
  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) {
    log.error({ refused }, 'job worker skipping workspaces with invalid registry records')
  }
  const wanted = new Set(workspaces.map((t) => t.workspaceKey))
  const now = Date.now()
  const toStop: WorkspaceLoop[] = []

  await withLoopSet(() => {
    for (const [workspaceKey, loop] of loops) {
      if (wanted.has(workspaceKey)) continue
      loop.deactivate()
      loops.delete(workspaceKey)
      toStop.push(loop)
      markStandingWork(workspaceKey, false)
    }
  })
  for (const workspaceKey of listDormantWorkspaces()) {
    if (!wanted.has(workspaceKey)) {
      markDormant(workspaceKey, false)
      scheduledWakes.delete(workspaceKey)
    }
  }

  let parked = 0
  let woke = 0
  for (const workspace of workspaces) {
    const key = workspace.workspaceKey
    const idle = isPastDormancyThreshold(workspace.lastActiveAt ?? null, now)

    if (!idle) {
      await withLoopSet(() => {
        markStandingWork(key, false)
        if (isMarkedDormant(key)) {
          markDormant(key, false)
          woke += 1
          log.info(
            { event: 'workspace.woke', workspace_key: key, last_active_at: workspace.lastActiveAt },
            'dormant workspace saw a request; starting its job loop'
          )
        }
        const existing = loops.get(key)
        if (existing) existing.observe(workspace)
        else startWorkspaceLoop(workspace, cfg)
      })
      continue
    }

    if (!loops.get(key) && isMarkedDormant(key)) {
      if (clockWakeDue(key, now) && (await wakeForClockWork(workspace, cfg, now))) woke += 1
      continue
    }

    const clock = await probeClockWork(workspace, now)
    let didPark = false
    await withLoopSet(() => {
      const existing = loops.get(key)
      if (!existing && isMarkedDormant(key)) return
      const keep =
        clock.standing ||
        (existing !== undefined &&
          (existing.inFlightCount() > 0 ||
            (existing.recentWakeAt > 0 && now - existing.recentWakeAt < WORKSPACE_REFRESH_MS)))
      markStandingWork(key, keep)
      if (keep) {
        scheduledWakes.delete(key)
        if (existing) existing.observe(workspace)
        else startWorkspaceLoop(workspace, cfg)
        return
      }
      if (existing) {
        existing.deactivate()
        loops.delete(key)
        toStop.push(existing)
      }
      markDormant(key, true)
      if (clock.nextAt === null) scheduledWakes.delete(key)
      else scheduledWakes.set(key, clock.nextAt)
      didPark = true
    })
    if (didPark) {
      parked += 1
      log.info(
        { event: 'workspace.dormant', workspace_key: key, last_active_at: workspace.lastActiveAt },
        'workspace idle past the dormancy threshold with no standing work; job loop parked'
      )
    }
  }

  for (const loop of toStop) await loop.stop()

  if (parked > 0 || woke > 0) {
    log.info(
      { event: 'job.worker_refresh', loops: loops.size, dormant: dormantCount(), parked, woke },
      'job worker loop set changed'
    )
  }

  reportQuarantine()

  // A parked workspace has no loop to enqueue its monthly usage report; queue
  // it for any that have not sent last month's (`dormant-usage-report.ts`).
  await catchUpDormantUsageReports({
    hosted: isHostedBillingConfigured,
    now: () => new Date(),
    dormant: listDormantWorkspaces,
    enqueueIn: (workspaceKey, month) =>
      withWorkspaceScopeById(workspaceKey, 'queue', () => enqueueUsageReport({ month })),
    wake: (workspaceKey) => wakeWorkspace(workspaceKey, []),
    warn: (fields, message) => log.warn(fields, message),
  }).catch((err) => log.warn({ err }, 'dormant usage report catch-up failed'))
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
  storedConfig = cfg
  unsubscribeCommit = onDurableWorkCommitted((work) => {
    void acceptDurableWork(work).catch((err) =>
      log.error({ err, workspace_key: work.workspaceKey }, 'after-commit start-by-id failed')
    )
  })

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
  storedConfig = null
  unsubscribeCommit?.()
  unsubscribeCommit = null
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  const all = [...loops.values()]
  for (const loop of all) loop.deactivate()
  loops.clear()
  await Promise.allSettled(all.map((l) => l.stop()))
  resetDormancyMarks()
  scheduledWakes.clear()
  resetJobHandlers()
  if (wasRunning) log.info({ event: 'job.worker_stopped' }, 'job worker stopped')
}

export interface JobWakeAbort {
  team: string
  channel: string
  thread: string
}

export interface JobWakeRequest {
  workspaceKey: string
  jobIds?: string[]
  abort?: JobWakeAbort
}

async function acceptDurableWork(work: DurableWork): Promise<void> {
  await wakeWorkspace(work.workspaceKey, work.jobIds)
}

/**
 * Start-by-id (and optional dormant loop start) for one workspace.
 * No-op when this process is not the worker.
 */
export async function wakeWorkspace(
  workspaceKey: string,
  jobIds: readonly string[]
): Promise<void> {
  if (!running || !shouldRunWorkers()) return
  const cfg = storedConfig
  if (!cfg) return

  let loop = await withLoopSet(() => {
    const existing =
      loops.get(workspaceKey) ?? (config.isPooledTenancy ? undefined : loops.get(SINGLE))
    if (!existing || existing.isStopped()) return undefined
    existing.nudge()
    return existing
  })

  if ((!loop || loop.isStopped()) && config.isPooledTenancy) {
    const lookup = await resolveWorkspaceById(workspaceKey)
    if (lookup.kind !== 'ok') {
      log.warn({ workspace_key: workspaceKey }, 'job-wake for unknown workspace')
      return
    }
    loop = await withLoopSet(() => {
      const existing = loops.get(workspaceKey)
      if (existing && !existing.isStopped()) {
        existing.nudge()
        return existing
      }
      startWorkspaceLoop(lookup.workspace, cfg)
      markDormant(workspaceKey, false)
      markStandingWork(workspaceKey, true)
      log.info(
        { event: 'workspace.woke', workspace_key: workspaceKey, via: 'job-wake' },
        'dormant workspace started from job-wake'
      )
      const started = loops.get(workspaceKey)
      started?.nudge()
      return started
    })
  }

  if (!loop || loop.isStopped()) return
  loop.nudge()
  if (jobIds.length > 0) {
    const claimed = await loop.tryStartByIds(jobIds)
    if (claimed > 0) {
      const row = stats.get(loop.workspaceKey)
      if (row) {
        row.claimed += claimed
        row.inFlight = loop.inFlightCount()
        if (row.inFlight > row.peakInFlight) row.peakInFlight = row.inFlight
      }
    }
  }
}

/** True when this process can claim. The HTTP route 503s otherwise. */
export function isJobWorkerRunning(): boolean {
  return running && shouldRunWorkers()
}

export async function handleJobWake(request: JobWakeRequest): Promise<void> {
  log.info(
    {
      event: 'job.wake_received',
      workspace_key: request.workspaceKey,
      job_ids: request.jobIds?.length ?? 0,
      abort: Boolean(request.abort),
    },
    'job wake received'
  )
  if (request.abort) {
    const { abortSlackTurn } = await import('@/integrations/slack/server/agent/turns')
    if (!abortSlackTurn(request.abort.team, request.abort.channel, request.abort.thread)) {
      log.info(
        {
          event: 'job.wake_abort_missed',
          workspace_key: request.workspaceKey,
        },
        'job-wake abort found no in-flight turn'
      )
    }
  }
  await wakeWorkspace(request.workspaceKey, request.jobIds ?? [])
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
