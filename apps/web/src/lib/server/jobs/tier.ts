/**
 * The job tier — one poll-driven loop per tenant.
 *
 * Composition, and nothing more: `runner.ts` decides what happens inside a
 * tenant scope, and this file owns the scopes, the timers and the tenant list.
 *
 * ## Why per-tenant loops rather than one fleet pass
 *
 * `tenancy/fleet.ts` already answers "iterate all tenants per tick", and that is
 * the right answer for a periodic sweep. It is the wrong answer for a queue: one
 * pass across N tenants serialises every tenant's claim behind every other
 * tenant's, so one slow tenant delays them all. Each tenant gets its own loop,
 * its own schedule state and its own bounded pool, and the fleet iteration is
 * reduced to *discovering* tenants rather than driving work.
 *
 * ## The poll is the mechanism, not a fallback
 *
 * A job starts within one poll interval of being enqueued. The claim is a
 * single indexed `FOR UPDATE SKIP LOCKED` query, cheap enough to run on a
 * short interval, and — unlike `LISTEN`-based wake-ups — it behaves identically
 * through a transaction-mode pooler, which silently never delivers a NOTIFY.
 * Anything needing sub-second delivery has the realtime bus; background work
 * does not.
 *
 * ## Single-tenant installs are the same shape
 *
 * Under `QUACKBACK_TENANCY=single` there is one loop and no scope. Nothing
 * about the registry, the fleet or the pool cache is touched.
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
import { isMissingJobQueue } from './job-queue'
import {
  awaitPool,
  createJobPool,
  createScheduleState,
  dispatchPass,
  poolSize,
  primeJobHandlers,
  resetJobHandlers,
  runJob,
  runPruneTick,
  runReapTick,
  runScheduleTick,
  runnerConfig,
  type RunnerConfig,
} from './runner'
import { onDurableWorkCommitted, SINGLE_WORKSPACE_KEY } from '@/lib/server/workspaces/after-commit'
import { convertRelayOwnedEvents } from '@/lib/server/events/event-dispatch-queue'

const log = logger.child({ component: 'job-tier' })

/** How often the pooled tier re-reads the tenant list from the control database. */
const TENANT_REFRESH_MS = 60_000

interface TenantLoop {
  tenantId: string
  stop(): Promise<void>
  /** End the current poll wait so an after-commit enqueue is claimed now. */
  signal(): void
  /** Latest registry view, so a revision change is seen without a restart. */
  observe(tenant: WorkspaceDescriptor): void
}

interface LoopStats {
  passes: number
  claimed: number
  succeeded: number
  failed: number
  scheduled: number
  /** Slots this tenant's scheduler decided were due, whoever won the write. */
  scheduleAttempts: number
  requeued: number
  terminated: number
  schemaMissing: boolean
  /** Jobs running right now, across every queue. */
  inFlight: number
  /** High-water mark of `inFlight`, for sizing the tier. */
  peakInFlight: number
  /** Set while this tenant is refused and not being retried. */
  refusedCode: string | null
}

const loops = new Map<string, TenantLoop>()
const stats = new Map<string, LoopStats>()
let running = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeCommit: (() => void) | null = null

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
 * One tenant's loop: schedule → dispatch → wait for a freed slot or the poll
 * interval.
 *
 * **The loop does not wait for the work it started.** `dispatchPass` hands
 * claimed jobs to a bounded pool and returns, so the next schedule tick happens
 * on time whatever the running jobs are doing. That is not a performance
 * nicety: `latestSlotAtOrBefore` returns only the slot bracketing now, so a
 * slot that elapses while the loop is blocked is never enqueued at all —
 * dropped, not delayed. With a 120-second `help-center-translate` job on a
 * serial loop, the per-minute `snooze-sweep` and `sla-breach-sweep` would each
 * silently lose two runs. Measured before and after; see JOBS.md §10.
 */
function startLoop(opts: {
  tenantId: string
  config: RunnerConfig
  /** Latest registry view. Null under single tenancy. */
  tenant: WorkspaceDescriptor | null
  scoped: <T>(body: () => Promise<T>) => Promise<T>
}): TenantLoop {
  const s = emptyStats()
  stats.set(opts.tenantId, s)

  let stopped = false
  let wakeResolve: (() => void) | null = null
  let nextScheduleAt = 0
  let nextReapAt = 0
  let nextPruneAt = 0
  let descriptor: WorkspaceDescriptor | null = opts.tenant
  /** True once the tenant has been proven servable. Cleared when a pass fails. */
  let servable = false
  // This loop's own scheduler memory. Per tenant by construction: the state is
  // created here, inside the closure, so there is nothing for a second tenant's
  // loop to share. See runner.ts's ScheduleState for what sharing it cost.
  const schedule = createScheduleState()
  // This loop's bounded worker pool. Per tenant for the same reason the
  // scheduler state is: one process runs one loop per tenant, and a shared pool
  // would let a busy tenant consume another's slots.
  const pool = createJobPool()

  /** End the current wait early. */
  const nudge = () => {
    const resolve = wakeResolve
    wakeResolve = null
    resolve?.()
  }

  const waitForWork = (ms: number) =>
    new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        wakeResolve = null
        resolve()
      }
      const timer = setTimeout(done, ms)
      timer.unref?.()
      wakeResolve = done
    })

  /**
   * Prove the tenant is servable before running anything against it, so a
   * refused tenant lands in quarantine's backoff instead of being retried at
   * the poll interval forever.
   */
  const prove = async (): Promise<boolean> => {
    if (descriptor && isWorkspaceQuarantined(descriptor)) return false
    try {
      // An empty body still builds and verifies the pool, which is the whole
      // question being asked. Under single tenancy `scoped` is identity and this
      // is a no-op, which is correct: there is nothing to refuse.
      await opts.scoped(async () => {})
    } catch (err) {
      const code = refusalCode(err)
      s.refusedCode = code
      if (descriptor) {
        const entry = noteWorkspaceRefusal(descriptor, code, errText(err))
        if (entry.disposition === 'transient') {
          log.warn(
            { tenantId: opts.tenantId, code, attempts: entry.attempts },
            'job tier could not open a scope for this tenant; backing off and retrying'
          )
        }
      } else {
        log.error({ err, tenantId: opts.tenantId }, 'job tier could not open a scope')
      }
      return false
    }
    if (descriptor) noteWorkspaceServed(descriptor.workspaceKey)
    s.refusedCode = null
    servable = true
    return true
  }

  const loop = async () => {
    while (running && !stopped) {
      if (!servable) {
        if (!(await prove())) {
          if (!running || stopped) break
          const retryAt = descriptor ? quarantineRetryAt(descriptor.workspaceKey) : null
          await waitForWork(retryAt ? Math.max(250, retryAt - Date.now()) : 1_000)
          continue
        }
      }
      try {
        const now = Date.now()

        const result = await opts.scoped(async () => {
          try {
            await convertRelayOwnedEvents()
          } catch (err) {
            log.warn({ err, tenantId: opts.tenantId }, 'relay-owned event convert failed')
          }
          if (now >= nextScheduleAt) {
            const tick = await runScheduleTick(schedule, new Date(now))
            s.scheduled += tick.enqueued
            s.scheduleAttempts += tick.attempted
            // Sleep until the next slot rather than re-asking every pass: the
            // schedule is deterministic, so a tick that finds nothing is pure
            // traffic against a per-tenant database.
            nextScheduleAt = tick.nextSlotAt ? tick.nextSlotAt.getTime() : now + 60_000
          }
          if (now >= nextReapAt) {
            const reaped = await runReapTick()
            s.requeued += reaped.requeued
            s.terminated += reaped.terminated
            nextReapAt = now + opts.config.reapIntervalMs
          }
          if (now >= nextPruneAt) {
            await runPruneTick(opts.config)
            nextPruneAt = now + opts.config.pruneIntervalMs
          }
          return dispatchPass({
            pool,
            config: opts.config,
            // Each job gets its own scope, opened here rather than inherited
            // from the pass that claimed it: the pass returns while the job is
            // still running, so a scope belonging to the pass would be the
            // wrong lifetime. A fresh one per job is the same guarantee the
            // serial version had, stated for a pool.
            run: (job) => opts.scoped(() => runJob(job)),
            onSettled: (_queue, outcome) => {
              if (outcome === 'succeeded') s.succeeded += 1
              else if (outcome === 'failed') s.failed += 1
              s.inFlight = poolSize(pool)
              // A freed slot is work the loop can claim now, so end the wait.
              nudge()
            },
          })
        })

        s.passes += 1
        s.claimed += result.claimed
        s.inFlight = poolSize(pool)
        if (s.inFlight > s.peakInFlight) s.peakInFlight = s.inFlight
        s.schemaMissing = false

        // Claimed something and still have room: go straight round again.
        if (result.claimed > 0 && !result.saturated) continue
      } catch (err) {
        if (isMissingJobQueue(err)) {
          if (!s.schemaMissing) {
            s.schemaMissing = true
            log.warn(
              { tenantId: opts.tenantId },
              'job_queue is absent in this database (migration 0250 not applied); ' +
                'skipping this workspace rather than crash-looping'
            )
          }
        } else {
          log.error({ err, tenantId: opts.tenantId }, 'job tier pass failed')
          // A failed pass may mean the tenant is no longer servable at all — a
          // rotated credential, a repointed record. Re-prove on the next
          // iteration so a persistent refusal is classified and backed off
          // rather than retried at the poll interval forever.
          servable = false
        }
      }
      if (!running || stopped) break
      await waitForWork(opts.config.pollIntervalMs)
    }
  }

  void runWithLogContext(
    { request_id: crypto.randomUUID(), route: 'jobs:tier', tenant_id: opts.tenantId },
    loop
  ).catch((err) => log.error({ err, tenantId: opts.tenantId }, 'job tier loop exited'))

  return {
    tenantId: opts.tenantId,
    signal: nudge,
    observe(tenant) {
      const changed = descriptor !== null && descriptor.revision !== tenant.revision
      descriptor = tenant
      // A changed record is the signal that a refusal may have been repaired,
      // and it is worthless if nobody is awake to act on it. A quarantined loop
      // is asleep on the terminal backoff — fifteen minutes by default — so
      // without this an operator's fix lands and then sits, which measured as a
      // repaired tenant still refused eighty seconds later.
      if (changed && !servable) nudge()
    },
    async stop() {
      stopped = true
      nudge()
      // In-flight jobs are left to finish. Cancelling them would abandon a
      // lease mid-work, which is precisely the case the reaper handles worst:
      // an at-most-once job that was claimed is spent, so an interrupted import
      // is a failed import rather than one that runs again on the next boot.
      // The caller's shutdown budget (startup.ts, 30s) bounds the wait.
      await awaitPool(pool)
      stats.delete(opts.tenantId)
    },
  }
}

/** The message off whatever was thrown, for a refusal record. */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function startSingleTenantLoop(cfg: RunnerConfig): void {
  const loop = startLoop({
    tenantId: SINGLE_WORKSPACE_KEY,
    config: cfg,
    tenant: null,
    scoped: (body) => body(),
  })
  loops.set(SINGLE_WORKSPACE_KEY, loop)
}

function startTenantLoop(workspace: WorkspaceDescriptor, cfg: RunnerConfig): void {
  const loop = startLoop({
    tenantId: workspace.workspaceKey,
    config: cfg,
    tenant: workspace,
    scoped: (body) => withWorkspaceScopeById(workspace.workspaceKey, 'queue', body),
  })
  loops.set(workspace.workspaceKey, loop)
}

async function refreshTenantLoops(cfg: RunnerConfig): Promise<void> {
  const { workspaces, refused } = await listActiveWorkspaces()
  if (refused.length > 0) {
    log.error({ refused }, 'job tier skipping tenants with invalid registry records')
  }
  const wanted = new Set(workspaces.map((w) => w.workspaceKey))

  // Departing tenants drain in parallel, and only after the new loops are
  // started: `stop()` waits out the tenant's in-flight jobs, so awaiting each
  // one serially here would let a single tenant draining a long job stall the
  // discovery of every new tenant in this pass.
  const stopping: Array<{ tenantId: string; done: Promise<void> }> = []
  for (const [tenantId, loop] of loops) {
    if (wanted.has(tenantId)) continue
    log.info({ tenantId }, 'tenant left the active set — stopping its job loop')
    loops.delete(tenantId)
    stopping.push({ tenantId, done: loop.stop() })
  }

  for (const workspace of workspaces) {
    const existing = loops.get(workspace.workspaceKey)
    if (existing) {
      // The revision the loop compares against when deciding whether a refusal
      // is still the same refusal. Without this a record repaired by the control
      // plane would stay quarantined until the process restarted.
      existing.observe(workspace)
      continue
    }
    startTenantLoop(workspace, cfg)
  }

  // On the one cadence that exists whether or not anything is wrong.
  reportQuarantine()

  const settled = await Promise.allSettled(stopping.map((s) => s.done))
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      log.error(
        { err: result.reason, tenantId: stopping[i].tenantId },
        'job loop for a departed tenant failed while stopping'
      )
    }
  })
}

function scheduleTenantRefresh(cfg: RunnerConfig): void {
  if (!running) return
  refreshTimer = setTimeout(() => {
    if (!running) return
    void refreshTenantLoops(cfg)
      .catch((err) => log.error({ err }, 'job tier tenant refresh failed'))
      .finally(() => scheduleTenantRefresh(cfg))
  }, TENANT_REFRESH_MS)
  refreshTimer.unref?.()
}

/**
 * Start the job tier. Worker-role only, so calling it on a web replica is a
 * no-op.
 */
export async function startJobTier(): Promise<void> {
  if (running) return
  if (!shouldRunWorkers()) {
    log.info('QUACKBACK_ROLE=web — job tier not started')
    return
  }
  running = true
  const cfg = runnerConfig()

  // Import every handler module before a single tenant scope is open, so no
  // module can execute its top level under one tenant's connection. See
  // runner.ts's primeJobHandlers for the shape this is guarding against.
  await primeJobHandlers()

  // After-commit flush nudges the in-process poll loop. There is no LISTEN
  // doorbell: Neon is gone, and a transaction-mode pooler would not deliver
  // NOTIFY anyway. The poll is the mechanism; this only cuts the wait.
  unsubscribeCommit = onDurableWorkCommitted((tenantId) => {
    signalWorkspace(tenantId)
  })

  if (!config.isPooledTenancy) {
    startSingleTenantLoop(cfg)
    log.info({ poll_interval_ms: cfg.pollIntervalMs }, 'job tier started (single tenant)')
    return
  }

  await refreshTenantLoops(cfg)
  scheduleTenantRefresh(cfg)
  log.info(
    { tenants: loops.size, poll_interval_ms: cfg.pollIntervalMs },
    'job tier started (pooled)'
  )
}

export async function stopJobTier(): Promise<void> {
  running = false
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  unsubscribeCommit?.()
  unsubscribeCommit = null
  const all = [...loops.values()]
  loops.clear()
  await Promise.allSettled(all.map((l) => l.stop()))
  // Each loop's scheduler state died with its closure. The handler memo is
  // process-wide, so drop it: a restarted tier may be running a different
  // definition list.
  resetJobHandlers()
}

export interface JobTierStatus {
  running: boolean
  workspaces: Array<{ workspaceKey: string } & LoopStats>
}

export function getJobTierStatus(): JobTierStatus {
  return {
    running,
    workspaces: [...stats.entries()].map(([workspaceKey, s]) => ({ workspaceKey, ...s })),
  }
}

/**
 * End this workspace's current poll wait so an after-commit enqueue is claimed now.
 */
export function signalWorkspace(workspaceKey: string): boolean {
  const loop = loops.get(workspaceKey)
  if (!loop) return false
  loop.signal()
  return true
}
