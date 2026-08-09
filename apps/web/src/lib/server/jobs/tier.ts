/**
 * The job tier — one always-warm loop per tenant.
 *
 * Composition, and nothing more: `runner.ts` decides what happens inside a
 * tenant scope, `wake.ts` owns the doorbell, and this file owns the scopes, the
 * timers and the tenant list.
 *
 * ## Why per-tenant loops rather than one fleet pass
 *
 * `tenancy/fleet.ts` already answers "iterate all tenants per tick", and that is
 * the right answer for a periodic sweep. It is the wrong answer for a queue: the
 * latency of an on-demand job would become the tick interval times the number of
 * tenants, and the whole point of the NOTIFY doorbell is that a job enqueued now
 * starts now. So each tenant gets its own loop and its own listener, and the
 * fleet iteration is reduced to *discovering* tenants rather than driving work.
 *
 * The cost of that choice is one session-mode connection per tenant on this
 * process, permanently. That is the tier §7.3 describes — always warm, direct
 * connections, physically separate from the pooled web tier — and it is why the
 * corollary in §6 matters: **this tier holds connections open by design, so it
 * must never share a compute with tenants you expect to suspend.** Sizing that
 * tier for a large fleet belongs to the relay-tier piece; what this file owes is
 * that the queue's use of it is correct and that its listener is verified by a
 * real notify rather than by a catalogue read.
 *
 * ## Single-tenant installs are unchanged in shape
 *
 * Under `QUACKBACK_TENANCY=single` there is one loop, no scope, and the listener
 * uses `DATABASE_URL` — which for a self-hosted install already is a direct,
 * session-mode connection. Nothing about the registry, the fleet or the pool
 * cache is touched.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { runWithLogContext } from '@/lib/server/log-context'
import { shouldRunWorkers } from '@/lib/server/process-role'
import { listActiveTenants, type TenantDescriptor } from '@/lib/server/tenancy/registry'
import { resolveTenantPassword } from '@/lib/server/tenancy/pool-cache'
import { withTenantScopeById } from '@/lib/server/tenancy/fleet'
import { isMissingJobQueue } from './job-queue'
import {
  awaitPool,
  createJobPool,
  createScheduleState,
  dispatchPass,
  poolSize,
  primeJobHandlers,
  wakeDisabled,
  resetJobHandlers,
  runJob,
  runMaintenanceTick,
  runScheduleTick,
  runnerConfig,
  type RunnerConfig,
} from './runner'
import { openWakeListener, type WakeListener } from './wake'

const log = logger.child({ component: 'job-tier' })

/** How often the pooled tier re-reads the tenant list. */
const TENANT_REFRESH_MS = 60_000

/** Sentinel tenant id for a single-tenant install. Never a real tenant id. */
const SINGLE = '__single__'

interface TenantLoop {
  tenantId: string
  stop(): Promise<void>
  /** Called by the wake listener when a NOTIFY arrives for this tenant. */
  ring(): void
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
  wakes: number
  /** Milliseconds from the notify arriving to the drain that answered it. */
  lastWakeLatencyMs: number | null
  schemaMissing: boolean
  /** Jobs running right now, across every queue. */
  inFlight: number
  /** High-water mark of `inFlight`, for sizing the tier. */
  peakInFlight: number
}

const loops = new Map<string, TenantLoop>()
const stats = new Map<string, LoopStats>()
let running = false
let refreshTimer: ReturnType<typeof setInterval> | null = null

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
    wakes: 0,
    lastWakeLatencyMs: null,
    schemaMissing: false,
    inFlight: 0,
    peakInFlight: 0,
  }
}

/**
 * One tenant's loop: schedule → dispatch → wait for a wake, a freed slot, or
 * the poll interval.
 *
 * The wait is a race between the doorbell and the poll. If the doorbell is lost
 * — a dropped connection, a pooled DSN, a NOTIFY that raced the LISTEN — the
 * poll still fires, so a lost wake costs latency and never correctness. That is
 * the same guarantee the outbox relay ships with, and it is why the poll
 * interval is a floor rather than a fallback nobody exercises.
 *
 * **The loop no longer waits for the work it started.** `dispatchPass` hands
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
  listener: WakeListener | null
  scoped: <T>(body: () => Promise<T>) => Promise<T>
}): TenantLoop {
  const s = emptyStats()
  stats.set(opts.tenantId, s)

  let stopped = false
  let wakeResolve: (() => void) | null = null
  let wakeAt: number | null = null
  let nextScheduleAt = 0
  let nextMaintenanceAt = 0
  // This loop's own scheduler memory. Per tenant by construction: the state is
  // created here, inside the closure, so there is nothing for a second tenant's
  // loop to share. See runner.ts's ScheduleState for what sharing it cost.
  const schedule = createScheduleState()
  // This loop's bounded worker pool. Per tenant for the same reason the
  // scheduler state is: one process runs one loop per tenant, and a shared pool
  // would let a busy tenant consume another's slots.
  const pool = createJobPool()

  /** End the current wait without claiming a doorbell arrived. */
  const nudge = () => {
    const resolve = wakeResolve
    wakeResolve = null
    resolve?.()
  }

  const ring = () => {
    if (wakeAt === null) wakeAt = Date.now()
    s.wakes += 1
    nudge()
  }

  const waitForWork = () =>
    new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        wakeResolve = null
        resolve()
      }
      const timer = setTimeout(done, opts.config.pollIntervalMs)
      timer.unref?.()
      wakeResolve = done
    })

  const loop = async () => {
    while (running && !stopped) {
      try {
        const now = Date.now()
        const wokenAt = wakeAt
        wakeAt = null

        const result = await opts.scoped(async () => {
          if (now >= nextScheduleAt) {
            const tick = await runScheduleTick(schedule, new Date(now))
            s.scheduled += tick.enqueued
            s.scheduleAttempts += tick.attempted
            // Sleep until the next slot rather than re-asking every second: the
            // schedule is deterministic, so a tick that finds nothing is pure
            // traffic against a per-tenant database.
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
              // A freed slot is work the loop can claim now, so end the wait —
              // but through `nudge`, not `ring`: `wakes` counts doorbell
              // arrivals and is the instrument the wake-latency harness reads.
              // Counting our own completions there would make the doorbell look
              // like it fired when it did not.
              nudge()
            },
          })
        })

        s.passes += 1
        s.claimed += result.claimed
        s.inFlight = poolSize(pool)
        if (s.inFlight > s.peakInFlight) s.peakInFlight = s.inFlight
        s.schemaMissing = false

        if (wokenAt !== null && result.claimed > 0) {
          s.lastWakeLatencyMs = Date.now() - wokenAt
        }

        // Claimed something and still have room: go straight round again.
        if (result.claimed > 0 && !result.saturated) continue
      } catch (err) {
        if (isMissingJobQueue(err)) {
          if (!s.schemaMissing) {
            s.schemaMissing = true
            log.warn(
              { tenantId: opts.tenantId },
              'job_queue is absent in this database (migration 0253 not applied); ' +
                'skipping this tenant rather than crash-looping'
            )
          }
        } else {
          log.error({ err, tenantId: opts.tenantId }, 'job tier pass failed')
        }
      }
      if (!running || stopped) break
      await waitForWork()
    }
  }

  void runWithLogContext(
    { request_id: crypto.randomUUID(), route: 'jobs:tier', tenant_id: opts.tenantId },
    loop
  ).catch((err) => log.error({ err, tenantId: opts.tenantId }, 'job tier loop exited'))

  return {
    tenantId: opts.tenantId,
    ring,
    async stop() {
      stopped = true
      nudge()
      await opts.listener?.close()
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

/**
 * Prove a freshly attached doorbell actually delivers, and say so loudly if it
 * does not.
 *
 * §7.3's finding is that this failure is silent: a pooled DSN accepts the
 * `LISTEN` registration and then delivers nothing, and `pg_listening_channels()`
 * reports the registration as present the whole time. A tier that attached and
 * assumed would run on the poll interval forever without a word. One NOTIFY
 * round trip per tenant at boot buys the difference between "slower than you
 * think" and "you know why".
 *
 * Deliberately not awaited by the caller: the queue is correct on the poll
 * interval alone, so a slow or failing probe must not delay boot.
 */
function verifyDoorbell(listener: WakeListener, label: string): void {
  void listener
    .verify()
    .then((ok) => {
      if (ok) return
      log.error(
        { tenant: label },
        'job wake doorbell attached but delivered nothing — this tenant is running on the ' +
          'poll interval alone. A pooled DSN produces exactly this; the listener needs the ' +
          'direct endpoint.'
      )
    })
    .catch((err) => log.warn({ err, tenant: label }, 'could not verify the job wake doorbell'))
}

async function startSingleTenantLoop(cfg: RunnerConfig): Promise<void> {
  const holder: { ring: (() => void) | null } = { ring: null }
  let listener: WakeListener | null = null
  if (wakeDisabled()) {
    log.warn('JOB_WAKE_DISABLED=1 — no doorbell; the queue runs on the poll interval alone')
  } else {
    try {
      listener = await openWakeListener({
        directUrl: config.databaseUrl,
        label: SINGLE,
        onWake: () => holder.ring?.(),
      })
      verifyDoorbell(listener, SINGLE)
    } catch (err) {
      log.error(
        { err },
        'could not attach the job wake listener; the queue runs on the poll fallback only'
      )
    }
  }

  const loop = startLoop({
    tenantId: SINGLE,
    config: cfg,
    listener,
    scoped: (body) => body(),
  })
  holder.ring = loop.ring
  loops.set(SINGLE, loop)
}

async function startTenantLoop(tenant: TenantDescriptor, cfg: RunnerConfig): Promise<void> {
  const holder: { ring: (() => void) | null } = { ring: null }
  let listener: WakeListener | null = null
  if (wakeDisabled()) {
    log.warn(
      { tenantId: tenant.tenantId },
      'JOB_WAKE_DISABLED=1 — no doorbell; this tenant runs on the poll interval alone'
    )
  } else {
    try {
      listener = await openWakeListener({
        // Direct, never pooled. Through a transaction pooler the registration is
        // accepted and nothing is ever delivered — see wake.ts.
        directUrl: tenant.database.directUrl,
        password: () => resolveTenantPassword(tenant),
        label: tenant.tenantId,
        onWake: () => holder.ring?.(),
      })
      verifyDoorbell(listener, tenant.tenantId)
    } catch (err) {
      log.error(
        { err, tenantId: tenant.tenantId },
        'could not attach the job wake listener; this tenant runs on the poll fallback only'
      )
    }
  }

  const loop = startLoop({
    tenantId: tenant.tenantId,
    config: cfg,
    listener,
    scoped: (body) => withTenantScopeById(tenant.tenantId, 'queue', body),
  })
  holder.ring = loop.ring
  loops.set(tenant.tenantId, loop)
}

async function refreshTenantLoops(cfg: RunnerConfig): Promise<void> {
  const { tenants, refused } = await listActiveTenants()
  if (refused.length > 0) {
    log.error({ refused }, 'job tier skipping tenants with invalid registry records')
  }
  const wanted = new Set(tenants.map((t) => t.tenantId))

  for (const [tenantId, loop] of loops) {
    if (wanted.has(tenantId)) continue
    log.info({ tenantId }, 'tenant left the active set — stopping its job loop')
    await loop.stop()
    loops.delete(tenantId)
  }

  for (const tenant of tenants) {
    if (loops.has(tenant.tenantId)) continue
    await startTenantLoop(tenant, cfg)
  }
}

/**
 * Start the job tier. Worker-role only, so calling it on a web replica is a
 * no-op — the same gate `startOutboxRelay` uses.
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

  if (!config.isPooledTenancy) {
    await startSingleTenantLoop(cfg)
    log.info({ poll_interval_ms: cfg.pollIntervalMs }, 'job tier started (single tenant)')
    return
  }

  await refreshTenantLoops(cfg)
  refreshTimer = setInterval(() => {
    void refreshTenantLoops(cfg).catch((err) =>
      log.error({ err }, 'job tier tenant refresh failed')
    )
  }, TENANT_REFRESH_MS)
  refreshTimer.unref?.()
  log.info(
    { tenants: loops.size, poll_interval_ms: cfg.pollIntervalMs },
    'job tier started (pooled)'
  )
}

export async function stopJobTier(): Promise<void> {
  running = false
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
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
  tenants: Array<{ tenantId: string } & LoopStats>
}

export function getJobTierStatus(): JobTierStatus {
  return {
    running,
    tenants: [...stats.entries()].map(([tenantId, s]) => ({ tenantId, ...s })),
  }
}
