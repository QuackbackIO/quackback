/**
 * Running claimed work — the half of the queue that executes outside a
 * transaction.
 *
 * Everything in this module assumes an open workspace scope: `db` resolves to the
 * workspace's pool, and `job_queue` is that workspace's own table. `tier.ts` owns
 * opening the scope and the timers; this file owns what happens inside one.
 *
 * The load-bearing property is that **no transaction is open while a handler
 * runs**. The claim commits, the handler runs for as long as it takes, and the
 * lease is extended by heartbeat. That is what lets a job outlive a transaction
 * — `help-center-translate` needs 120 seconds today, and an export build or an
 * AI call can need far more.
 *
 * Configuration is read from `process.env` directly rather than through the zod
 * config, matching `process-role.ts`: these knobs must work in any context,
 * including a worker process that has not loaded the full application config.
 */
import { logger } from '@/lib/server/logger'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import {
  claimJobs,
  completeJob,
  failJob,
  heartbeatJob,
  pruneTerminalJobs,
  reapExpiredLeases,
  type ClaimedJob,
  type QueueClaimSpec,
  type ReapResult,
} from './job-queue'
import {
  concurrencyFor,
  findJobDefinition,
  isTerminalJobError,
  jobDefinitions,
  leaseMsFor,
  maxAttemptsFor,
  retentionOverrides,
  retryBackoffMs,
  type DynamicSchedule,
  type JobDefinition,
  type JobHandler,
} from './definitions'
import { enqueueJob } from './job-queue'
import { latestSlotAtOrBefore, nextSlotAfter, parseCron, slotKey, type ParsedCron } from './cron'

const log = logger.child({ component: 'job-runner' })

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    log.warn({ [name]: raw, fallback }, 'invalid job-tier setting, using the default')
    return fallback
  }
  return n
}

export interface RunnerConfig {
  /** Poll fallback interval. The correctness floor when a NOTIFY is lost. */
  pollIntervalMs: number
  /** Ceiling on rows claimed from ONE queue in a single pass. */
  batchSize: number
  /** How often expired leases are reclaimed. */
  reapIntervalMs: number
  /** How long terminal rows are kept. Must exceed any live cron slot key. */
  retentionMs: number
  /**
   * Ceiling on jobs running at once in one workspace's loop.
   *
   * Defaults to the sum of every definition's `concurrency`, which is exactly
   * what the reference allowed (one BullMQ `Worker` per queue, each at its own
   * concurrency), so the default binds nothing and single-workspace behaviour does
   * not move. It exists because a pooled process runs one loop per workspace, and
   * a fleet operator sizing connections cares about the product, not the term.
   */
  maxConcurrency: number
}

/** Sum of every registered queue's concurrency — the reference's own ceiling. */
export function totalDeclaredConcurrency(): number {
  return jobDefinitions().reduce((n, def) => n + concurrencyFor(def), 0)
}

export function runnerConfig(): RunnerConfig {
  return {
    pollIntervalMs: envInt('JOB_POLL_INTERVAL_MS', 1_000, 50, 600_000),
    batchSize: envInt('JOB_BATCH_SIZE', 5, 1, 100),
    reapIntervalMs: envInt('JOB_REAP_INTERVAL_MS', 15_000, 500, 3_600_000),
    retentionMs: envInt('JOB_RETENTION_MS', 7 * 24 * 60 * 60 * 1000, 60_000, 365 * 86_400_000),
    maxConcurrency: envInt('JOB_MAX_CONCURRENCY', totalDeclaredConcurrency(), 1, 512),
  }
}

/** All queue names the tier will claim for. */
export function activeQueueNames(): string[] {
  return jobDefinitions().map((d) => d.name)
}

/**
 * Handler modules, imported once and memoised.
 *
 * The reason this exists is a hazard measured on the BullMQ side of the house: a
 * `Worker` constructed inside a request's workspace scope inherits that scope for
 * every job it ever processes, because the scope is AsyncLocalStorage and the
 * constructor captured it. It was not a theoretical shape — the queue modules
 * that armed lazily on first enqueue armed inside whatever request reached them
 * first. No such module is left, but the *import* hazard below outlives them.
 *
 * This queue does not have that shape — `tier.ts` opens a fresh
 * `withWorkspaceScopeById(...)` around every pass, so a handler always runs inside
 * the scope of the job it is running, never one captured earlier. But the
 * *import* is a second, quieter version of the same risk: `def.handler()` is a
 * dynamic import, and a module executing top-level work would run it inside
 * whichever workspace's scope happened to trigger the first import.
 *
 * `primeJobHandlers()` closes that by importing every module once, at tier
 * start, **before any workspace scope is open**. The memo is then a pure function
 * lookup. A miss still resolves rather than failing — a direct `runJob` in a
 * test must work — but it says so, because a miss in a running tier means a
 * module is being imported under a workspace scope.
 */
const handlerMemo = new Map<string, JobHandler>()

export async function primeJobHandlers(): Promise<void> {
  if (getCurrentWorkspace()) {
    // Priming is the thing that must happen OUTSIDE a scope. If a caller has one
    // open, priming here would defeat its own purpose silently.
    log.error(
      'primeJobHandlers() was called inside a workspace scope — handler modules would ' +
        'be imported under that workspace. Prime before opening any scope.'
    )
    return
  }
  for (const def of jobDefinitions()) {
    if (handlerMemo.has(def.name)) continue
    try {
      handlerMemo.set(def.name, await def.handler())
    } catch (err) {
      log.error({ err, queue: def.name }, 'could not load job handler')
    }
  }
}

/** Test/shutdown seam: drop the memo so a new definition list is picked up. */
export function resetJobHandlers(): void {
  handlerMemo.clear()
}

async function resolveHandler(def: JobDefinition): Promise<JobHandler> {
  const memo = handlerMemo.get(def.name)
  if (memo) return memo
  if (getCurrentWorkspace()) {
    log.warn(
      { queue: def.name },
      'job handler module imported inside a workspace scope — prime handlers at tier start'
    )
  }
  const handler = await def.handler()
  handlerMemo.set(def.name, handler)
  return handler
}

/**
 * Run one job to completion, with a heartbeat holding the lease open.
 *
 * The heartbeat runs at a third of the lease so two consecutive misses still
 * leave a margin before the reaper takes the job. A heartbeat that finds the
 * lease gone is logged at error: it means the reaper decided this worker was
 * dead while it was in fact still working, which is either a lease set too short
 * for the work or a stalled process — both worth seeing.
 */
export async function runJob(job: ClaimedJob): Promise<'succeeded' | 'failed' | 'retrying'> {
  const def = findJobDefinition(job.queue)
  if (!def) {
    log.error({ jobId: job.jobId, queue: job.queue }, 'no handler registered for queue')
    await failJob(job, `no handler registered for queue "${job.queue}"`)
    return 'failed'
  }

  const leaseMs = leaseMsFor(def)
  let leaseLost = false
  const heartbeat = setInterval(
    () => {
      void heartbeatJob(job, leaseMs)
        .then((held) => {
          if (held) return
          leaseLost = true
          log.error(
            { jobId: job.jobId, queue: job.queue },
            'lease lost while the handler was still running — another worker may now own this job'
          )
        })
        .catch((err) => log.warn({ err, jobId: job.jobId }, 'heartbeat failed'))
    },
    Math.max(1_000, Math.floor(leaseMs / 3))
  )
  heartbeat.unref?.()

  const startedAt = Date.now()
  try {
    const handler = await resolveHandler(def)
    await handler(job)
  } catch (err) {
    clearInterval(heartbeat)
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    // A terminal error is the reference's `UnrecoverableError`: retrying an
    // unknown hook type or a deleted segment burns attempts to reach the same
    // answer. It only ever makes the outcome final sooner — see failJob.
    const terminal = isTerminalJobError(err)
    const outcome = await failJob(job, message, {
      backoffMs: retryBackoffMs(def, job.attempts),
      terminal,
    })
    log.error(
      {
        err,
        jobId: job.jobId,
        queue: job.queue,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        terminal,
        outcome,
      },
      'job handler failed'
    )
    // The reference expressed this as `worker.on('failed')`, and the webhook
    // auto-disable counter depends on the `permanent` distinction: counting a
    // retry would disable a flaky endpoint after ~17 events instead of 50.
    // 'lease-lost' is NOT permanent — the job now belongs to another worker,
    // and attributing its failure here would double-count.
    if (def.onFailure) {
      await def
        .onFailure(job, err, outcome === 'failed')
        .catch((hookErr) =>
          log.error(
            { err: hookErr, jobId: job.jobId, queue: job.queue },
            'job onFailure hook threw'
          )
        )
    }
    return outcome === 'retrying' ? 'retrying' : 'failed'
  }
  clearInterval(heartbeat)

  const completed = await completeJob(job)
  if (!completed) {
    log.error(
      { jobId: job.jobId, queue: job.queue, leaseLost, duration_ms: Date.now() - startedAt },
      'job finished but its lease was gone — the result was NOT recorded'
    )
    return 'failed'
  }
  log.debug(
    { jobId: job.jobId, queue: job.queue, duration_ms: Date.now() - startedAt },
    'job complete'
  )
  return 'succeeded'
}

export interface DrainResult {
  claimed: number
  succeeded: number
  failed: number
  retrying: number
}

/**
 * The tier's bounded worker pool — the answer to the hand-off `JOBS.md` §10
 * left for this piece.
 *
 * **The problem it solves.** The first cohort drained serially: claim a batch,
 * run it to completion, then go round again and tick the schedule. That was
 * fine while every sweep was sub-second, and `JOBS.md` §10 said so explicitly.
 * It stops being fine the moment `help-center-translate` arrives, because its
 * lease is 120 seconds — and the slots that elapse while the loop is inside a
 * long job are *dropped, not delayed*: `latestSlotAtOrBefore` only ever returns
 * the slot bracketing now, so a two-minute job costs the per-minute
 * `snooze-sweep` and `sla-breach-sweep` two runs each, silently.
 *
 * **Why a pool rather than per-queue loops.** Fifteen loops per workspace would
 * multiply the poll traffic by fifteen against a per-workspace database, and the
 * database is the scarce thing here — §6's corollary is that this tier already
 * holds a connection per workspace open by design. One loop keeps one poll, one
 * listener and one claim query per pass, whatever the queue count.
 *
 * **Why per-queue caps rather than one pool size.** The reference gave each
 * queue its own `Worker` with its own `concurrency`, and one of those numbers
 * is load-bearing: `workflow-dispatch` is `concurrency: 1` because it is a
 * global FIFO, not because it is slow. A single undifferentiated pool would run
 * two dispatch jobs at once and reorder a reply and a close on one
 * conversation. So the cap is per queue, the claim asks for exactly the free
 * slots each queue has, and the FIFO queue can never have two in flight.
 */
export interface JobPool {
  /** Jobs currently running, per queue. */
  readonly inFlight: Map<string, number>
  /** Every running job's promise, so a caller can wait the pool out. */
  readonly active: Set<Promise<void>>
}

export function createJobPool(): JobPool {
  return { inFlight: new Map(), active: new Set() }
}

export function poolSize(pool: JobPool): number {
  let n = 0
  for (const count of pool.inFlight.values()) n += count
  return n
}

/** The free slots each queue has right now, given the pool and the caps. */
export function claimSpecsFor(pool: JobPool, config: RunnerConfig): QueueClaimSpec[] {
  let budget = Math.max(0, config.maxConcurrency - poolSize(pool))
  const specs: QueueClaimSpec[] = []
  for (const def of jobDefinitions()) {
    if (budget <= 0) break
    const free = Math.min(
      concurrencyFor(def) - (pool.inFlight.get(def.name) ?? 0),
      config.batchSize,
      budget
    )
    if (free < 1) continue
    specs.push({ queue: def.name, limit: free, leaseMs: leaseMsFor(def) })
    budget -= free
  }
  return specs
}

export interface DispatchResult {
  claimed: number
  /** True when every queue was already at its cap, so nothing was even asked for. */
  saturated: boolean
}

/**
 * Claim what the pool has room for and start it — without waiting for it.
 *
 * Returning before the work finishes is the whole point: the caller's next act
 * is the schedule tick, and a 120-second job must not stand between a
 * per-minute sweep and its slot.
 */
export async function dispatchPass(opts: {
  pool: JobPool
  config: RunnerConfig
  /** Runs one job, in whatever workspace scope the caller owns. */
  run: (job: ClaimedJob) => Promise<'succeeded' | 'failed' | 'retrying'>
  /** Called as each job settles, so the loop can claim the freed slot at once. */
  onSettled?: (queue: string, outcome: 'succeeded' | 'failed' | 'retrying') => void
}): Promise<DispatchResult> {
  const { pool } = opts
  const specs = claimSpecsFor(pool, opts.config)
  if (specs.length === 0) return { claimed: 0, saturated: true }

  const jobs = await claimJobs({ specs })
  for (const job of jobs) {
    pool.inFlight.set(job.queue, (pool.inFlight.get(job.queue) ?? 0) + 1)
    const promise = opts
      .run(job)
      .catch((err): 'failed' => {
        // runJob already records every handler failure on the row; reaching
        // here means the queue machinery itself threw, which must still free
        // the slot rather than wedge the pool at its cap forever.
        log.error({ err, jobId: job.jobId, queue: job.queue }, 'job runner threw outside runJob')
        return 'failed'
      })
      .then((outcome) => {
        const held = pool.inFlight.get(job.queue) ?? 1
        if (held <= 1) pool.inFlight.delete(job.queue)
        else pool.inFlight.set(job.queue, held - 1)
        pool.active.delete(promise)
        opts.onSettled?.(job.queue, outcome)
      })
    pool.active.add(promise)
  }
  return { claimed: jobs.length, saturated: false }
}

/** Wait for every job the pool is running. */
export async function awaitPool(pool: JobPool): Promise<void> {
  while (pool.active.size > 0) await Promise.all([...pool.active])
}

/**
 * Claim one pass and run it to completion.
 *
 * The same claim and the same execution path the tier uses — this is
 * `dispatchPass` plus a wait, not a second implementation — so a harness or a
 * test that drives this is exercising the shipped mechanism. Per-queue
 * concurrency still applies, so a queue declared `concurrency: 1` yields one
 * job per call, exactly as its BullMQ `Worker` did.
 */
export async function drainOnce(config: RunnerConfig): Promise<DrainResult> {
  const out: DrainResult = { claimed: 0, succeeded: 0, failed: 0, retrying: 0 }
  const pool = createJobPool()
  const result = await dispatchPass({
    pool,
    config,
    run: runJob,
    onSettled: (_queue, outcome) => {
      if (outcome === 'succeeded') out.succeeded += 1
      else if (outcome === 'retrying') out.retrying += 1
      else out.failed += 1
    },
  })
  out.claimed = result.claimed
  await awaitPool(pool)
  return out
}

export interface ScheduleTickResult {
  /**
   * Slots this scheduler decided were due and wrote for.
   *
   * Distinct from `enqueued` on purpose. `enqueued` is what the database
   * accepted, so it is 0 when another replica won the same slot — a normal,
   * healthy race. `attempted` is this scheduler's own decision, and it is the
   * only way to tell "another replica got there first" apart from "this
   * scheduler never considered the slot due at all", which is what shared
   * scheduler state produced across workspaces.
   */
  attempted: number
  enqueued: number
  /** Earliest next slot across all schedules, including gated-off ones. */
  nextSlotAt: Date | null
  /**
   * Earliest next slot of schedules that actually ran this tick.
   * Gated-off `* * * * *` must not appear here — the process scheduler
   * heaps this, and a snooze/SLA gate that is off must not wake every minute.
   */
  nextEnabledSlotAt: Date | null
}

const cronCache = new Map<string, ParsedCron>()

function cronFor(pattern: string): ParsedCron {
  let parsed = cronCache.get(pattern)
  if (!parsed) {
    parsed = parseCron(pattern)
    cronCache.set(pattern, parsed)
  }
  return parsed
}

/**
 * One scheduler's memory of the last slot it has accounted for, per schedule.
 *
 * **This is per workspace, and it is passed in rather than held here, because the
 * module-scope version of it was a real cross-workspace defect.** One process runs
 * one loop per workspace; a `Map` keyed on the schedule name alone is shared by all
 * of them, so whichever workspace's loop reached a slot first advanced a counter
 * every other workspace then read as "already done" — and the rest silently never
 * enqueued that slot. Measured live on two workspaces: each minute's sweep
 * landed on one workspace, never both. It affected all seven sweeps.
 *
 * That is the §4.1 process-global-state hazard, introduced by the piece meant to
 * remove it. Keying the map by workspace would fix the instance; making the state a
 * parameter fixes the class, because there is no longer a shared object for the
 * next scheduler to key wrongly.
 *
 * ## What the state is for
 *
 * The first pass **adopts** the current slot without enqueueing it. That is not
 * an optimisation — it is the behaviour the repeatable jobs had, and its absence
 * was a divergence caught by running the old and new builds side by side.
 * Registering a repeatable job schedules its NEXT occurrence; it does not run
 * the occurrence that has already passed. Without the seed, a process booting at
 * 14:00 immediately runs the 03:00 daily sweep — once, because the dedupe key
 * makes a slot spendable once, but at entirely the wrong time of day.
 *
 * The residual difference is narrow and worth stating: the repeatable job's next
 * occurrence lives in Redis and therefore survives a restart, while this seed is
 * per process. A restart in the same minute as a slot skips that slot. A restart
 * at any other time does not.
 */
export interface ScheduleState {
  readonly seen: Map<string, number>
}

/** A scheduler's own state. One per workspace loop — never shared between them. */
export function createScheduleState(): ScheduleState {
  return { seen: new Map<string, number>() }
}

/**
 * Enqueue the current slot of every cron-scheduled job.
 *
 * Only the slot bracketing `now` is emitted — never a backlog. A tier that was
 * down for three hours runs an hourly sweep once on restart rather than three
 * times, which is what the BullMQ repeatable jobs did.
 *
 * Two replicas racing the same tick both attempt the insert and the unique index
 * on `(queue, dedupe_key)` settles it, so the cross-instance exclusion is a
 * database property rather than a lock this code has to hold.
 */
export async function runScheduleTick(
  state: ScheduleState,
  now = new Date()
): Promise<ScheduleTickResult> {
  let attempted = 0
  let enqueued = 0
  let nextSlotAt: Date | null = null
  let nextEnabledSlotAt: Date | null = null

  // Every schedule name this tick considered. Anything in the state that is no
  // longer here belonged to a schedule that has gone away — a deleted segment,
  // an IMAP mailbox unconfigured — and holding its slot forever would leak.
  const live = new Set<string>()

  /** One schedule: a queue, a cron, and the payload its jobs carry. */
  const tick = async (
    def: JobDefinition,
    stateKey: string,
    dedupeName: string,
    pattern: string,
    payload: Record<string, unknown>
  ): Promise<void> => {
    const cron = cronFor(pattern)
    live.add(stateKey)

    const slot = latestSlotAtOrBefore(cron, now)
    const seen = state.seen.get(stateKey)
    if (seen === undefined) {
      // First pass for THIS scheduler: adopt the current slot, do not run it.
      if (slot) state.seen.set(stateKey, slot.getTime())
    } else if (slot && slot.getTime() > seen) {
      attempted += 1
      const result = await enqueueJob({
        queue: def.name,
        dedupeKey: slotKey(dedupeName, slot),
        payload: { ...payload, scheduledFor: slot.toISOString() },
        maxAttempts: maxAttemptsFor(def),
      })
      state.seen.set(stateKey, slot.getTime())
      if (result.inserted) {
        enqueued += 1
        log.debug({ queue: def.name, slot: slot.toISOString() }, 'scheduled job enqueued')
      }
    }

    const next = nextSlotAfter(cron, now)
    if (next && (!nextSlotAt || next < nextSlotAt)) nextSlotAt = next
    if (next && (!nextEnabledSlotAt || next < nextEnabledSlotAt)) nextEnabledSlotAt = next
  }

  /**
   * Spend this slot without running anything.
   *
   * What a shut `cronEnabled` gate means: this slot had nothing to do, which is
   * the same as having done it. Recording it is what makes the *next* slot new
   * when the gate opens.
   *
   * Without this the gate was silently self-defeating. A schedule that never
   * ticks never records a slot, so it has no memory; a pass with no memory is a
   * first pass, and a first pass deliberately adopts the current slot rather
   * than running it (or every process restart would replay one of everything).
   * A gate that opens is therefore always a first pass, and the work never runs
   * — measured against a real workspace, a snooze due in ninety seconds was never
   * swept at all. Harmless while gates flipped for a minute at a time; fatal
   * once a gate can stay shut for hours.
   *
   * `live` and `nextSlotAt` are maintained for the same reason: a gated-off
   * schedule is not one that has gone away, and the attached listener loop
   * still asks the gate on that slot. `nextEnabledSlotAt` deliberately omits
   * this — the process scheduler must not heap a gated-off per-minute cron.
   */
  const adopt = (stateKey: string, pattern: string): void => {
    const cron = cronFor(pattern)
    live.add(stateKey)
    const slot = latestSlotAtOrBefore(cron, now)
    if (slot) state.seen.set(stateKey, slot.getTime())
    const next = nextSlotAfter(cron, now)
    if (next && (!nextSlotAt || next < nextSlotAt)) nextSlotAt = next
  }

  for (const def of jobDefinitions()) {
    if (def.cron) {
      // A disabled schedule writes nothing, rather than enqueueing a job whose
      // handler returns immediately. The reference achieved the same by never
      // constructing the worker; a table full of no-op rows would not.
      let enabled = true
      if (def.cronEnabled) {
        try {
          enabled = await def.cronEnabled()
        } catch (err) {
          enabled = false
          log.error({ err, queue: def.name }, 'cron gate threw; treating the schedule as disabled')
        }
      }
      if (enabled) await tick(def, def.name, def.name, def.cron, {})
      else adopt(def.name, def.cron)
    }

    if (def.dynamicSchedules) {
      let schedules: readonly DynamicSchedule[] = []
      try {
        schedules = await def.dynamicSchedules()
      } catch (err) {
        log.error({ err, queue: def.name }, 'could not read dynamic schedules for this queue')
      }
      for (const schedule of schedules) {
        // The dedupe key must separate the schedules sharing this queue, or the
        // first segment's slot would spend every other segment's.
        const dedupeName = `${def.name}:${schedule.key}`
        try {
          await tick(def, dedupeName, dedupeName, schedule.cron, schedule.payload)
        } catch (err) {
          log.error(
            { err, queue: def.name, schedule: schedule.key },
            'a dynamic schedule could not be ticked'
          )
        }
      }
    }
  }

  for (const key of [...state.seen.keys()]) {
    if (!live.has(key)) state.seen.delete(key)
  }

  return { attempted, enqueued, nextSlotAt, nextEnabledSlotAt }
}

export interface MaintenanceResult extends ReapResult {
  pruned: number
}

/** Reclaim expired leases, then drop terminal rows past retention. */
export async function runMaintenanceTick(config: RunnerConfig): Promise<MaintenanceResult> {
  const reaped = await reapExpiredLeases()
  const pruned = await pruneTerminalJobs(config.retentionMs, retentionOverrides())
  return { ...reaped, pruned }
}
