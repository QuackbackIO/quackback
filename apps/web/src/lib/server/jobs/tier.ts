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
import { shouldRunWorkers } from '@/lib/server/queue/role'
import { listActiveTenants, type TenantDescriptor } from '@/lib/server/tenancy/registry'
import { resolveTenantPassword } from '@/lib/server/tenancy/pool-cache'
import { withTenantScopeById } from '@/lib/server/tenancy/fleet'
import { isMissingJobQueue } from './job-queue'
import {
  drainOnce,
  resetScheduleState,
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
  requeued: number
  terminated: number
  wakes: number
  /** Milliseconds from the notify arriving to the drain that answered it. */
  lastWakeLatencyMs: number | null
  schemaMissing: boolean
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
    requeued: 0,
    terminated: 0,
    wakes: 0,
    lastWakeLatencyMs: null,
    schemaMissing: false,
  }
}

/**
 * One tenant's loop: schedule → drain → wait for a wake or the poll interval.
 *
 * The wait is a race between the doorbell and the poll. If the doorbell is lost
 * — a dropped connection, a pooled DSN, a NOTIFY that raced the LISTEN — the
 * poll still fires, so a lost wake costs latency and never correctness. That is
 * the same guarantee the outbox relay ships with, and it is why the poll
 * interval is a floor rather than a fallback nobody exercises.
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

  const ring = () => {
    if (wakeAt === null) wakeAt = Date.now()
    s.wakes += 1
    const resolve = wakeResolve
    wakeResolve = null
    resolve?.()
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
            const tick = await runScheduleTick(new Date(now))
            s.scheduled += tick.enqueued
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
          return drainOnce(opts.config)
        })

        s.passes += 1
        s.claimed += result.claimed
        s.succeeded += result.succeeded
        s.failed += result.failed
        s.schemaMissing = false

        if (wokenAt !== null && result.claimed > 0) {
          s.lastWakeLatencyMs = Date.now() - wokenAt
        }

        // A full batch means there is probably more; go straight round again.
        if (result.claimed > 0) continue
      } catch (err) {
        if (isMissingJobQueue(err)) {
          if (!s.schemaMissing) {
            s.schemaMissing = true
            log.warn(
              { tenantId: opts.tenantId },
              'job_queue is absent in this database (migration 0252 not applied); ' +
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
      wakeResolve?.()
      await opts.listener?.close()
      stats.delete(opts.tenantId)
    },
  }
}

async function startSingleTenantLoop(cfg: RunnerConfig): Promise<void> {
  const holder: { ring: (() => void) | null } = { ring: null }
  let listener: WakeListener | null = null
  try {
    listener = await openWakeListener({
      directUrl: config.databaseUrl,
      label: SINGLE,
      onWake: () => holder.ring?.(),
    })
  } catch (err) {
    log.error(
      { err },
      'could not attach the job wake listener; the queue runs on the poll fallback only'
    )
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
  try {
    listener = await openWakeListener({
      // Direct, never pooled. Through a transaction pooler the registration is
      // accepted and nothing is ever delivered — see wake.ts.
      directUrl: tenant.database.directUrl,
      password: () => resolveTenantPassword(tenant),
      label: tenant.tenantId,
      onWake: () => holder.ring?.(),
    })
  } catch (err) {
    log.error(
      { err, tenantId: tenant.tenantId },
      'could not attach the job wake listener; this tenant runs on the poll fallback only'
    )
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
  // A restarted tier adopts the current slot again rather than inheriting a
  // seed from the previous run.
  resetScheduleState()
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
