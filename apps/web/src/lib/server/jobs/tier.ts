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
 * The cost of that choice used to be one session-mode connection per tenant on
 * this process, **permanently** — the shape §7.3 describes and §6's corollary
 * tolerated ("this tier holds connections open by design, so it must never share
 * a compute with tenants you expect to suspend"). Measured, that corollary meant
 * no tenant could ever suspend: a doorbell held for 14h33m per tenant, and the
 * pooled entries the poll kept renewing behind it, on databases doing no work.
 *
 * So the connection is now held **while the tenant is doing something** and
 * released when it is not — the doorbell, and the pooled entry in the request
 * cache with it, because releasing only the listener leaves the poll holding the
 * compute awake and saves nothing. `tenancy/idle.ts` owns that policy and its
 * numbers; this file owns applying it to the queue without losing the property
 * that a job enqueued now starts now.
 *
 * ## What "doing something" means here, and why the scheduler does not count
 *
 * This tier's own schedules must not count. `snooze-sweep` and `sla-breach-sweep`
 * are written `* * * * *`, and if enqueuing them counted as the tenant being
 * busy then every tenant would be busy forever and nothing would ever detach —
 * the loop would be measuring its own heartbeat. So work this loop created for
 * itself is subtracted: only claims beyond what the scheduler just enqueued, and
 * signals from outside the tier, reset the idle clock.
 *
 * A doorbell ring does not reset it either, for the same reason: the `job_queue`
 * insert trigger rings for *any* insert, including the scheduler's own. The ring
 * still ends the wait immediately — that is what it is for — and the claim it
 * leads to is what decides whether anything external happened.
 *
 * The subtraction alone would not have been enough. A per-minute schedule that
 * still *enqueued* every minute would keep the compute awake through the work it
 * created, whatever this loop called it. `jobs/deadlines.ts` is the other half:
 * those two schedules are gated on the tenant actually having a clock running,
 * so a tenant with nothing pending enqueues nothing, and a tenant with a
 * deadline three days out is woken at the deadline rather than 4,320 times
 * before it.
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
import {
  idleDetachDisabled,
  onTenantActivity,
  tenantIdlePolicy,
  type ReattachReason,
  type TenantIdlePolicy,
} from '@/lib/server/tenancy/idle'
import {
  isTenantQuarantined,
  noteTenantRefusal,
  noteTenantServed,
  quarantineRetryAt,
  refusalCode,
  reportQuarantine,
} from '@/lib/server/tenancy/quarantine'
import { earliestTenantDeadline } from './deadlines'
import { earliestPendingJobAt, isMissingJobQueue } from './job-queue'
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

/**
 * How often the pooled tier re-reads the tenant list while it is serving anyone.
 *
 * This read goes to the **control** database, which is now expected to suspend
 * when the fleet goes quiet, so a fixed 60-second timer would be the client that
 * keeps it awake for ever — the same defect as the tenant doorbells, one level
 * up. While any tenant is attached the fleet is doing something and the control
 * database is being read on the request path anyway, so 60 seconds costs
 * nothing; once every loop has detached, the interval stretches to the rescan
 * interval so the control compute can go down with the tenants.
 */
const TENANT_REFRESH_MS = 60_000

/** Sentinel tenant id for a single-tenant install. Never a real tenant id. */
const SINGLE = '__single__'

interface TenantLoop {
  tenantId: string
  stop(): Promise<void>
  /** Called by the wake listener when a NOTIFY arrives for this tenant. */
  ring(): void
  /** Something outside this tier opened a scope for this tenant. */
  signal(): void
  /** Latest registry view, so a revision change is seen without a restart. */
  observe(tenant: TenantDescriptor): void
  /** True while this loop holds any connection to the tenant database. */
  isAttached(): boolean
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
  /**
   * True while this loop holds connections to the tenant database.
   *
   * The counterpart to `poolsEvicted` in the pool cache, and a first-class field
   * for the same reason: detaching has no functional symptom either. A fleet
   * where this reads `true` for every tenant for ever is a fleet paying for
   * every compute, and nothing else would say so.
   */
  attached: boolean
  detaches: number
  reattaches: number
  /** Why the most recent re-attach happened. `rescan` repeatedly is a smell. */
  lastReattachReason: ReattachReason | null
  /** Set while this tenant is refused and not being retried. */
  refusedCode: string | null
}

const loops = new Map<string, TenantLoop>()
const stats = new Map<string, LoopStats>()
let running = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeActivity: (() => void) | null = null

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
    attached: false,
    detaches: 0,
    reattaches: 0,
    lastReattachReason: null,
    refusedCode: null,
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
  idle: TenantIdlePolicy
  /** Latest registry view. Null under single tenancy, where nothing detaches. */
  tenant: TenantDescriptor | null
  /** Builds this tenant's doorbell. Returns null when it could not be attached. */
  openListener: (ring: () => void) => Promise<WakeListener | null>
  scoped: <T>(body: () => Promise<T>) => Promise<T>
}): TenantLoop {
  const s = emptyStats()
  stats.set(opts.tenantId, s)

  let stopped = false
  let wakeResolve: (() => void) | null = null
  let wakeAt: number | null = null
  let nextScheduleAt = 0
  let nextMaintenanceAt = 0

  /**
   * Single-tenant installs never detach.
   *
   * There is one database, it is `DATABASE_URL`, and the request path shares the
   * very pool this would be releasing. Nothing about a self-hosted Postgres is
   * billed for idleness, so the whole trade has no upside there and a real
   * downside: a doorbell that comes and goes on the one database everything uses.
   */
  const canDetach = opts.tenant !== null && !idleDetachDisabled(opts.idle)
  let descriptor: TenantDescriptor | null = opts.tenant
  let listener: WakeListener | null = null
  let attached = false
  /** Last time something happened that this loop did not cause itself. */
  let lastExternalAt = Date.now()
  /**
   * Jobs this loop's own scheduler has enqueued and not yet seen claimed.
   *
   * The subtraction that keeps the tier from measuring its own heartbeat: two
   * schedules fire every minute for every tenant, so without this the claim they
   * produce would read as the tenant being busy, for ever.
   */
  let selfEnqueued = 0
  let detachedAt = 0
  /** When the queue's own future work is due, learned on the way out. */
  let deadlineAt: number | null = null
  /** Set when a signal arrives while detached, so the wake reports its cause. */
  let signalled = false
  /** Doorbell verification is per DSN, so it runs once per revision, not per attach. */
  let verifiedRevision: number | null = null
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

  /**
   * A doorbell arrived.
   *
   * Ends the wait, and deliberately does **not** touch `lastExternalAt`. The
   * `job_queue` insert trigger rings for any insert, including the two schedules
   * this loop fires every minute, so treating a ring as evidence of outside
   * activity would keep every tenant permanently warm. The claim it leads to is
   * what decides that, and the subtraction above is how.
   */
  const ring = () => {
    if (wakeAt === null) wakeAt = Date.now()
    s.wakes += 1
    nudge()
  }

  /**
   * Something outside this tier opened a scope for the tenant.
   *
   * Ends the wait **only when detached**. This fires on every request, so an
   * attached loop that woke on it would run a claim query per request rather
   * than per poll interval — a tenant at 100 req/s would drive a hundred passes
   * a second against its own database. An attached loop already has the
   * doorbell, which is the signal that says there is work rather than merely
   * that someone is here; all this needs to do while attached is keep the idle
   * clock from expiring.
   */
  const signal = () => {
    lastExternalAt = Date.now()
    if (attached) return
    signalled = true
    nudge()
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
   * Take hold of the tenant: prove it is servable, then open its doorbell.
   *
   * The order is the fix for the second half of the measured defect. The doorbell
   * needs no credentials, so it used to attach happily to tenants whose secrets
   * could not be resolved at all — two of the four measured tenants held a
   * permanent `LISTEN` on a database this fleet was refusing once per second.
   * Proving the tenant first means a refused tenant costs no connection at all.
   */
  const attach = async (reason: ReattachReason): Promise<boolean> => {
    if (descriptor && isTenantQuarantined(descriptor)) return false
    try {
      // An empty body still builds and verifies the pool, which is the whole
      // question being asked. Under single tenancy `scoped` is identity and this
      // is a no-op, which is correct: there is nothing to refuse.
      await opts.scoped(async () => {})
    } catch (err) {
      const code = refusalCode(err)
      s.refusedCode = code
      if (descriptor) {
        const entry = noteTenantRefusal(descriptor, code, errText(err))
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

    if (descriptor) noteTenantServed(descriptor.tenantId)
    s.refusedCode = null
    listener = await opts.openListener(ring)
    if (listener && descriptor && verifiedRevision !== descriptor.revision) {
      verifiedRevision = descriptor.revision
      verifyDoorbell(listener, opts.tenantId)
    } else if (listener && !descriptor && verifiedRevision === null) {
      verifiedRevision = 0
      verifyDoorbell(listener, opts.tenantId)
    }

    attached = true
    s.attached = true
    lastExternalAt = Date.now()
    deadlineAt = null
    if (reason !== 'boot') {
      s.reattaches += 1
      s.lastReattachReason = reason
      log.info({ tenantId: opts.tenantId, reason }, 'job tier re-attached to tenant')
    }
    return true
  }

  /**
   * Let go of everything this loop holds for the tenant.
   *
   * The deadline read happens **before** the connections close, on the one this
   * loop is about to drop, because it is the last chance to ask. Without it a
   * delayed job or a hook retry would wait for the safety-net rescan rather than
   * running when it was scheduled to.
   *
   * The pooled entry in the request cache is not evicted from here, and that is
   * deliberate. It is shared with the request path under `QUACKBACK_ROLE=all`,
   * and ending a pool out from under a request that is mid-flight would trade a
   * cost problem for a correctness one. It does not need evicting: the only
   * reason it survived was this loop touching it once per second, and once that
   * stops, `sweepIdlePools` drops it on its own within `tenantPoolIdleSeconds`
   * — which is the mechanism that module already documents and the reason its
   * threshold sits below this one.
   */
  const detach = async (): Promise<void> => {
    if (!attached) return
    attached = false
    s.attached = false
    s.detaches += 1
    const held = listener
    listener = null

    deadlineAt = null
    try {
      // Two sources, and both are needed. `job_queue` covers work that has
      // already been enqueued for a future instant — a hook retry, a scheduled
      // publish. The deadline providers cover work that has not been enqueued at
      // all and never will be until a clock says so: a snooze expiring, an SLA
      // breach falling due. Reading only the first would let a detached tenant
      // sleep straight through its own SLA.
      const [queued, clocked] = await opts.scoped(async () => [
        await earliestPendingJobAt(),
        await earliestTenantDeadline(),
      ])
      const candidates = [queued, clocked].filter((d): d is Date => d !== null)
      if (candidates.length > 0) {
        deadlineAt = Math.min(...candidates.map((d) => d.getTime()))
      }
    } catch (err) {
      // Not fatal: losing the deadline costs latency on delayed work, which the
      // rescan still bounds. Losing the detach would cost the compute.
      if (!isMissingJobQueue(err)) {
        log.warn({ err, tenantId: opts.tenantId }, 'could not read the queue deadline on detach')
      }
    }

    detachedAt = Date.now()
    await held?.close().catch(() => {})
    log.info(
      {
        tenantId: opts.tenantId,
        deadline_at: deadlineAt ? new Date(deadlineAt).toISOString() : null,
        idle_ms: detachedAt - lastExternalAt,
      },
      'job tier detached from tenant — doorbell released, poll stopped'
    )
  }

  /** How long to sleep while detached, and what to call the wake when it ends. */
  const detachedWaitMs = (): number => {
    const rescanAt = detachedAt + opts.idle.rescanIntervalMs
    const at = deadlineAt !== null ? Math.min(deadlineAt, rescanAt) : rescanAt
    // A floor so a deadline already in the past cannot spin the loop.
    return Math.max(250, at - Date.now())
  }

  const wakeReason = (): ReattachReason => {
    if (signalled) return 'signal'
    if (deadlineAt !== null && Date.now() >= deadlineAt) return 'deadline'
    return 'rescan'
  }

  const shouldDetach = (): boolean =>
    canDetach && poolSize(pool) === 0 && Date.now() - lastExternalAt >= opts.idle.detachAfterMs

  const loop = async () => {
    while (running && !stopped) {
      if (!attached) {
        const reason = s.passes === 0 && s.detaches === 0 ? 'boot' : wakeReason()
        signalled = false
        if (!(await attach(reason))) {
          if (!running || stopped) break
          const retryAt = descriptor ? quarantineRetryAt(descriptor.tenantId) : null
          await waitForWork(retryAt ? Math.max(250, retryAt - Date.now()) : 1_000)
          continue
        }
      }
      try {
        const now = Date.now()
        const wokenAt = wakeAt
        wakeAt = null

        const result = await opts.scoped(async () => {
          if (now >= nextScheduleAt) {
            const tick = await runScheduleTick(schedule, new Date(now))
            s.scheduled += tick.enqueued
            s.scheduleAttempts += tick.attempted
            // Remember what we made for ourselves, so claiming it back does not
            // read as the tenant being busy.
            selfEnqueued += tick.enqueued
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

        // Anything claimed beyond what this loop just enqueued for itself came
        // from outside, and only that resets the idle clock.
        const external = result.claimed - Math.min(result.claimed, selfEnqueued)
        selfEnqueued = Math.max(0, selfEnqueued - result.claimed)
        if (external > 0) lastExternalAt = Date.now()

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
      if (shouldDetach()) {
        await detach()
        if (!running || stopped) break
        await waitForWork(detachedWaitMs())
        continue
      }
      await waitForWork(opts.config.pollIntervalMs)
    }
    // Whatever ended the loop, the connections go with it.
    await detach().catch(() => {})
  }

  void runWithLogContext(
    { request_id: crypto.randomUUID(), route: 'jobs:tier', tenant_id: opts.tenantId },
    loop
  ).catch((err) => log.error({ err, tenantId: opts.tenantId }, 'job tier loop exited'))

  return {
    tenantId: opts.tenantId,
    ring,
    signal,
    observe(tenant) {
      descriptor = tenant
    },
    isAttached: () => attached,
    async stop() {
      stopped = true
      nudge()
      const held = listener
      listener = null
      attached = false
      s.attached = false
      await held?.close()
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

function startSingleTenantLoop(cfg: RunnerConfig, idle: TenantIdlePolicy): void {
  const holder: { ring: (() => void) | null } = { ring: null }
  const loop = startLoop({
    tenantId: SINGLE,
    config: cfg,
    idle,
    tenant: null,
    openListener: async (ring) => {
      holder.ring = ring
      if (wakeDisabled()) {
        log.warn('JOB_WAKE_DISABLED=1 — no doorbell; the queue runs on the poll interval alone')
        return null
      }
      try {
        return await openWakeListener({
          directUrl: config.databaseUrl,
          label: SINGLE,
          onWake: () => holder.ring?.(),
        })
      } catch (err) {
        log.error(
          { err },
          'could not attach the job wake listener; the queue runs on the poll fallback only'
        )
        return null
      }
    },
    scoped: (body) => body(),
  })
  loops.set(SINGLE, loop)
}

function startTenantLoop(
  tenant: TenantDescriptor,
  cfg: RunnerConfig,
  idle: TenantIdlePolicy
): void {
  const holder: { ring: (() => void) | null } = { ring: null }
  const loop = startLoop({
    tenantId: tenant.tenantId,
    config: cfg,
    idle,
    tenant,
    // Opened per attach rather than once at boot, and only after the tenant has
    // been proven servable. A doorbell needs no credentials, so opening it first
    // is what let two unservable tenants each hold a permanent `LISTEN`.
    openListener: async (ring) => {
      holder.ring = ring
      if (wakeDisabled()) {
        log.warn(
          { tenantId: tenant.tenantId },
          'JOB_WAKE_DISABLED=1 — no doorbell; this tenant runs on the poll interval alone'
        )
        return null
      }
      try {
        return await openWakeListener({
          // Direct, never pooled. Through a transaction pooler the registration
          // is accepted and nothing is ever delivered — see wake.ts.
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
        return null
      }
    },
    scoped: (body) => withTenantScopeById(tenant.tenantId, 'queue', body),
  })
  loops.set(tenant.tenantId, loop)
}

async function refreshTenantLoops(cfg: RunnerConfig, idle: TenantIdlePolicy): Promise<void> {
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
    const existing = loops.get(tenant.tenantId)
    if (existing) {
      // The revision the loop compares against when deciding whether a refusal
      // is still the same refusal. Without this a record repaired by the control
      // plane would stay quarantined until the process restarted.
      existing.observe(tenant)
      continue
    }
    startTenantLoop(tenant, cfg, idle)
  }

  // On the one cadence that exists whether or not anything is wrong.
  reportQuarantine()
}

/**
 * Re-arm the tenant refresh at a cadence the fleet's own state justifies.
 *
 * A `setInterval` cannot do this, because the right interval changes: 60 seconds
 * while any tenant is attached, and the rescan interval once every loop has let
 * go. The second case is the one that matters — this read goes to the control
 * database, and a fixed minute timer would hold that compute awake for ever
 * while every tenant it names slept.
 */
function scheduleTenantRefresh(cfg: RunnerConfig, idle: TenantIdlePolicy): void {
  if (!running) return
  const anyAttached = [...loops.values()].some((l) => l.isAttached())
  const delay = anyAttached ? TENANT_REFRESH_MS : Math.max(TENANT_REFRESH_MS, idle.rescanIntervalMs)
  refreshTimer = setTimeout(() => {
    void refreshTenantLoops(cfg, idle)
      .catch((err) => log.error({ err }, 'job tier tenant refresh failed'))
      .finally(() => scheduleTenantRefresh(cfg, idle))
  }, delay)
  refreshTimer.unref?.()
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
  const idle = tenantIdlePolicy()

  // Import every handler module before a single tenant scope is open, so no
  // module can execute its top level under one tenant's connection. See
  // runner.ts's primeJobHandlers for the shape this is guarding against.
  await primeJobHandlers()

  // A scope opened by anything that is not a tier means the tenant's compute is
  // already awake and being used, so a detached loop should come straight back.
  unsubscribeActivity = onTenantActivity((tenantId) => loops.get(tenantId)?.signal())

  if (!config.isPooledTenancy) {
    startSingleTenantLoop(cfg, idle)
    log.info({ poll_interval_ms: cfg.pollIntervalMs }, 'job tier started (single tenant)')
    return
  }

  await refreshTenantLoops(cfg, idle)
  scheduleTenantRefresh(cfg, idle)
  log.info(
    {
      tenants: loops.size,
      poll_interval_ms: cfg.pollIntervalMs,
      idle_detach_ms: idle.detachAfterMs,
      idle_rescan_ms: idle.rescanIntervalMs,
    },
    'job tier started (pooled)'
  )
}

export async function stopJobTier(): Promise<void> {
  running = false
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  unsubscribeActivity?.()
  unsubscribeActivity = null
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
