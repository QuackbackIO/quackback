/**
 * Running claimed work — the half of the queue that executes outside a
 * transaction.
 *
 * Everything in this module assumes an open tenant scope: `db` resolves to the
 * tenant's pool, and `job_queue` is that tenant's own table. `tier.ts` owns
 * opening the scope and the timers; this file owns what happens inside one.
 *
 * The load-bearing property is that **no transaction is open while a handler
 * runs**. The claim commits, the handler runs for as long as it takes, and the
 * lease is extended by heartbeat. That is what lets a job outlive a transaction
 * — `help-center-translate` needs 120 seconds today, and an export build or an
 * AI call can need far more.
 *
 * Configuration is read from `process.env` directly rather than through the zod
 * config, matching `queue/role.ts`: these knobs must work in any context,
 * including a worker process that has not loaded the full application config.
 */
import { logger } from '@/lib/server/logger'
import {
  claimJobs,
  completeJob,
  failJob,
  heartbeatJob,
  pruneTerminalJobs,
  reapExpiredLeases,
  type ClaimedJob,
  type ReapResult,
} from './job-queue'
import {
  findJobDefinition,
  jobDefinitions,
  leaseMsFor,
  maxAttemptsFor,
  retryBackoffMs,
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
  /** Jobs claimed per drain pass. */
  batchSize: number
  /** How often expired leases are reclaimed. */
  reapIntervalMs: number
  /** How long terminal rows are kept. Must exceed any live cron slot key. */
  retentionMs: number
}

export function runnerConfig(): RunnerConfig {
  return {
    pollIntervalMs: envInt('JOB_POLL_INTERVAL_MS', 1_000, 50, 600_000),
    batchSize: envInt('JOB_BATCH_SIZE', 5, 1, 100),
    reapIntervalMs: envInt('JOB_REAP_INTERVAL_MS', 15_000, 500, 3_600_000),
    retentionMs: envInt('JOB_RETENTION_MS', 7 * 24 * 60 * 60 * 1000, 60_000, 365 * 86_400_000),
  }
}

/** All queue names the tier will claim for. */
export function activeQueueNames(): string[] {
  return jobDefinitions().map((d) => d.name)
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
    const handler = await def.handler()
    await handler(job)
  } catch (err) {
    clearInterval(heartbeat)
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    const outcome = await failJob(job, message, {
      backoffMs: retryBackoffMs(def, job.attempts),
    })
    log.error(
      {
        err,
        jobId: job.jobId,
        queue: job.queue,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        outcome,
      },
      'job handler failed'
    )
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
 * Claim and run one batch, serially.
 *
 * Serial on purpose: every sweep in the first cohort ran at `concurrency: 1`
 * under BullMQ, and these run against a per-tenant database whose compute is
 * sized for one tenant's ordinary load.
 */
export async function drainOnce(config: RunnerConfig): Promise<DrainResult> {
  const queues = activeQueueNames()
  const out: DrainResult = { claimed: 0, succeeded: 0, failed: 0, retrying: 0 }
  if (queues.length === 0) return out

  // One lease length covers the batch: each definition may want its own, so the
  // claim uses the longest and each job's heartbeat then works to its own.
  const leaseMs = Math.max(
    ...jobDefinitions().map((d) => leaseMsFor(d)),
    // A definitionless queue cannot appear here (queues comes from the same
    // list), but Math.max of an empty array is -Infinity, so seed it.
    1_000
  )

  const jobs = await claimJobs({ queues, limit: config.batchSize, leaseMs })
  out.claimed = jobs.length
  for (const job of jobs) {
    const outcome = await runJob(job)
    if (outcome === 'succeeded') out.succeeded += 1
    else if (outcome === 'retrying') out.retrying += 1
    else out.failed += 1
  }
  return out
}

export interface ScheduleTickResult {
  enqueued: number
  /** Earliest next slot across all schedules, for setting the next timer. */
  nextSlotAt: Date | null
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
 * The last slot this process has accounted for, per schedule.
 *
 * The first pass **adopts** the current slot without enqueueing it, and that is
 * not an optimisation — it is the behaviour the repeatable jobs had, and the
 * absence of it was a real divergence caught by running both side by side.
 * Registering a repeatable job schedules its NEXT occurrence; it does not run
 * the occurrence that has already passed. Without the seed, a process booting at
 * 14:00 would immediately run the 03:00 daily sweep — once, because the dedupe
 * key makes a slot spendable once, but at entirely the wrong time of day, and
 * an off-peak sweep that fires at 14:00 is a behaviour change even though the
 * per-day count is unchanged.
 *
 * The residual difference is narrow and worth stating: the repeatable job's next
 * occurrence lives in Redis and therefore survives a restart, while this seed is
 * per process. A restart in the same minute as a slot skips that slot. A restart
 * at any other time does not.
 */
const seenSlot = new Map<string, number>()

/** Test/shutdown seam: forget the seed so the next pass adopts afresh. */
export function resetScheduleState(): void {
  seenSlot.clear()
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
export async function runScheduleTick(now = new Date()): Promise<ScheduleTickResult> {
  let enqueued = 0
  let nextSlotAt: Date | null = null

  for (const def of jobDefinitions()) {
    if (!def.cron) continue
    const cron = cronFor(def.cron)

    const slot = latestSlotAtOrBefore(cron, now)
    const seen = seenSlot.get(def.name)
    if (seen === undefined) {
      // First pass in this process: adopt the current slot, do not run it.
      if (slot) seenSlot.set(def.name, slot.getTime())
    } else if (slot && slot.getTime() > seen) {
      const result = await enqueueJob({
        queue: def.name,
        dedupeKey: slotKey(def.name, slot),
        payload: { scheduledFor: slot.toISOString() },
        maxAttempts: maxAttemptsFor(def),
      })
      seenSlot.set(def.name, slot.getTime())
      if (result.inserted) {
        enqueued += 1
        log.debug({ queue: def.name, slot: slot.toISOString() }, 'scheduled job enqueued')
      }
    }

    const next = nextSlotAfter(cron, now)
    if (next && (!nextSlotAt || next < nextSlotAt)) nextSlotAt = next
  }

  return { enqueued, nextSlotAt }
}

export interface MaintenanceResult extends ReapResult {
  pruned: number
}

/** Reclaim expired leases, then drop terminal rows past retention. */
export async function runMaintenanceTick(config: RunnerConfig): Promise<MaintenanceResult> {
  const reaped = await reapExpiredLeases()
  const pruned = await pruneTerminalJobs(config.retentionMs)
  return { ...reaped, pruned }
}
