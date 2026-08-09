/**
 * The lease primitive (SAAS-HOSTING-STACK.md §7.2).
 *
 * `FOR UPDATE SKIP LOCKED` releases the instant the claiming transaction
 * commits, so it cannot on its own hold a job through a multi-minute AI call or
 * an export build — the only way to do that with row locks is to keep a
 * transaction open for minutes, which pins vacuum and occupies a pooler slot for
 * the duration. `help-center-translate` already needs a 120s lock today.
 *
 * The shape here instead:
 *
 * ```
 *   claimJobs()      short transaction: pending -> running, stamp the lease   COMMIT
 *   <handler runs>   NO transaction open. Any duration.
 *   heartbeatJob()   extends locked_until, guarded by the fencing token
 *   completeJob()    short transaction: running -> succeeded
 * ```
 *
 * and a reaper reclaims leases whose owner died.
 *
 * ## The reaper is where this goes wrong, so read this before changing it
 *
 * `import` and `export` deliberately run with one attempt, because a retry
 * would double-import a customer's data. A reaper that returned every expired
 * lease to `pending` would silently convert *"this job must run at most once"*
 * into *"this job runs again whenever a process dies mid-work"* — the same
 * defect, with no error and no log, arriving only under the failure it was
 * supposed to survive.
 *
 * Two rules make at-most-once expressible, and they are the same rule stated at
 * two points so neither can be the only one:
 *
 * 1. **`attempts` is incremented by the CLAIM**, not by completion. A job with
 *    `maxAttempts = 1` that was claimed even once already reads `attempts = 1`,
 *    so it is spent whether or not anything reported back.
 * 2. **`attempts < max_attempts` gates both the claim and the reaper's requeue.**
 *    A spent job is not claimable and is not requeueable; an expired lease on
 *    one becomes terminal `failed` with a named reason.
 *
 * At-most-once means exactly that: a killed no-retry job may end up having run
 * zero times or once, never twice. "Always exactly once" is not available to
 * anybody — it would require the side effect and the bookkeeping to commit
 * together, and the side effect is usually not in this database.
 *
 * ## The fencing token
 *
 * Every write after the claim is guarded by `lease_token`. A process that
 * stalls past its lease, has the job reaped, then resumes and reports success
 * updates zero rows and is told its lease was lost. Without the token it would
 * overwrite whatever the job's new owner had done.
 *
 * ## The tenant assertion
 *
 * The queue is per-tenant because the table lives in the tenant's own database —
 * there is no shared queue to route out of. That is a structural property, but
 * §3's whole point is that a wrong-tenant answer passes every other check in the
 * system without erroring, so structure alone is not evidence. Every claimed row
 * is checked against the ambient scope and a mismatch is refused loudly and made
 * terminal, never executed. The check lives inside `claimJobs` rather than in
 * each caller so there is no version of "forgot to assert".
 */
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { sql } from 'drizzle-orm'
import { generateId } from '@quackback/ids'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'
import { getCurrentTenant } from '@/lib/server/tenancy/tenant-context'

const log = logger.child({ component: 'job-queue' })

/** Postgres `undefined_table`. The tenant has not run migration 0253 yet. */
export const UNDEFINED_TABLE = '42P01'

export class JobQueueMissingError extends Error {
  constructor() {
    super(
      'job_queue does not exist in this database. Migration 0253 has not been applied here; ' +
        'the queue tier skips this tenant rather than crash-looping (expand lands before the ' +
        'code that reads it — SAAS-HOSTING-STACK.md §5, §10.5).'
    )
    this.name = 'JobQueueMissingError'
  }
}

/** True when an error is Postgres complaining that `job_queue` is absent. */
export function isMissingJobQueue(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === UNDEFINED_TABLE
}

export interface EnqueueJobInput {
  queue: string
  payload?: Record<string, unknown>
  /**
   * Idempotency handle, unique per queue across every status. A second enqueue
   * with the same key is a no-op — including after the first one finished, which
   * is what makes a cron slot spendable exactly once.
   */
  dedupeKey?: string | null
  /** Earliest instant the job may run. Defaults to now. */
  runAt?: Date
  /**
   * Total attempts allowed. **1 (the default) means at-most-once** — an expired
   * lease goes terminal rather than back to pending. `import` and `export` need
   * this; a retry would double-import a customer's data.
   */
  maxAttempts?: number
}

export interface EnqueueJobResult {
  jobId: string
  /** False when `dedupeKey` already existed, so nothing was written. */
  inserted: boolean
}

/** The subset of a claimed row a handler and the lease writes need. */
export interface ClaimedJob {
  id: string
  jobId: string
  queue: string
  payload: Record<string, unknown>
  tenantId: string | null
  attempts: number
  maxAttempts: number
  leaseToken: string
  lockedUntil: Date
}

interface ClaimRow {
  id: string | number | bigint
  job_id: string
  queue: string
  payload: Record<string, unknown> | null
  tenant_id: string | null
  attempts: number
  max_attempts: number
  lease_token: string
  locked_until: Date | string
}

/** Stable per-process identity, for `locked_by` and for reading logs. */
let workerIdMemo: string | null = null
export function jobWorkerId(): string {
  if (!workerIdMemo) workerIdMemo = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  return workerIdMemo
}

/** Test seam — a fresh identity makes two in-process runners distinguishable. */
export function __resetJobWorkerIdForTests(): void {
  workerIdMemo = null
}

function currentTenantId(): string | null {
  return getCurrentTenant()?.tenantId ?? null
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Put a job on this tenant's queue.
 *
 * `tenant_id` is stamped from the ambient scope, which is also what the claim
 * asserts against. There is no way to enqueue for a different tenant, because
 * there is no shared queue and no tenant parameter — you would have to open that
 * tenant's scope, at which point you are writing into its own database.
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const jobId = generateId('job')
  const maxAttempts = input.maxAttempts ?? 1
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be an integer >= 1, received ${String(input.maxAttempts)}`)
  }

  const result = await db.execute(sql`
    INSERT INTO job_queue (job_id, queue, dedupe_key, tenant_id, payload, run_at, max_attempts)
    VALUES (
      ${jobId},
      ${input.queue},
      ${input.dedupeKey ?? null},
      ${currentTenantId()},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${input.runAt ? input.runAt.toISOString() : sql`now()`},
      ${maxAttempts}
    )
    ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING job_id
  `)

  const rows = getExecuteRows<{ job_id: string }>(result)
  return { jobId, inserted: rows.length > 0 }
}

export interface ClaimJobsInput {
  queues: readonly string[]
  limit: number
  /** How long the claim holds the job before the reaper may take it back. */
  leaseMs: number
}

/**
 * Claim up to `limit` runnable jobs, in one short transaction.
 *
 * `attempts` is incremented here. That placement is the whole at-most-once
 * property — see the module header before moving it.
 */
export async function claimJobs(input: ClaimJobsInput): Promise<ClaimedJob[]> {
  if (input.queues.length === 0 || input.limit < 1) return []

  // A JSON array rather than a Postgres array literal: Drizzle's `sql` template
  // flattens a JS array into one parameter per element, so `= ANY($1::text[])`
  // arrives as a bare string and Postgres rejects it as a malformed array. This
  // shape parameterises cleanly and leaves the value opaque to the parser.
  const queues = JSON.stringify([...input.queues])
  const result = await db.execute(sql`
    WITH claimable AS (
      SELECT id
      FROM job_queue
      WHERE status = 'pending'
        AND queue IN (SELECT jsonb_array_elements_text(${queues}::jsonb))
        AND run_at <= now()
        -- The second barrier. A spent job must not be claimable even if some
        -- other writer put it back to pending; see the module header.
        AND attempts < max_attempts
      ORDER BY run_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${input.limit}
    )
    UPDATE job_queue j
    SET status = 'running',
        attempts = j.attempts + 1,
        lease_token = gen_random_uuid(),
        locked_until = now() + make_interval(secs => ${input.leaseMs / 1000}),
        locked_by = ${jobWorkerId()},
        started_at = COALESCE(j.started_at, now()),
        updated_at = now()
    FROM claimable c
    WHERE j.id = c.id
    RETURNING j.id, j.job_id, j.queue, j.payload, j.tenant_id,
              j.attempts, j.max_attempts, j.lease_token, j.locked_until
  `)

  const rows = getExecuteRows<ClaimRow>(result)
  const expected = currentTenantId()
  const claimed: ClaimedJob[] = []

  for (const row of rows) {
    const job: ClaimedJob = {
      id: String(row.id),
      jobId: row.job_id,
      queue: row.queue,
      payload: row.payload ?? {},
      tenantId: row.tenant_id,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      leaseToken: row.lease_token,
      lockedUntil: asDate(row.locked_until),
    }

    if (job.tenantId !== expected) {
      // Refuse loudly and terminally. This row is not another tenant's job —
      // it is a corrupt row in THIS tenant's database — but running it would be
      // a cross-tenant execution, which is the one outcome the whole design
      // exists to make impossible.
      log.error(
        {
          jobId: job.jobId,
          queue: job.queue,
          rowTenantId: job.tenantId,
          scopeTenantId: expected,
        },
        'job REFUSED: row tenant does not match the tenant scope that claimed it'
      )
      await terminate(
        job,
        `tenant mismatch: row is stamped ${job.tenantId ?? 'null'}, scope is ${expected ?? 'null'}`
      )
      continue
    }

    claimed.push(job)
  }

  return claimed
}

/** Terminal-fail a job outright, bypassing the retry decision. */
async function terminate(job: ClaimedJob, reason: string): Promise<void> {
  await db.execute(sql`
    UPDATE job_queue
    SET status = 'failed',
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = now(),
        last_error = ${reason},
        updated_at = now()
    WHERE id = ${job.id}::bigint AND lease_token = ${job.leaseToken}::uuid AND status = 'running'
  `)
}

/**
 * Extend a lease while the handler is still working.
 *
 * Returns false when the lease is gone — the job was reaped and possibly handed
 * to another worker. A handler that gets false should stop: anything it writes
 * from here is racing whoever holds the job now.
 */
export async function heartbeatJob(job: ClaimedJob, leaseMs: number): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE job_queue
    SET locked_until = now() + make_interval(secs => ${leaseMs / 1000}),
        updated_at = now()
    WHERE id = ${job.id}::bigint AND lease_token = ${job.leaseToken}::uuid AND status = 'running'
    RETURNING id
  `)
  return getExecuteRows(result).length > 0
}

/** Mark a job done. False means the lease was lost and nothing was written. */
export async function completeJob(job: ClaimedJob): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE job_queue
    SET status = 'succeeded',
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE id = ${job.id}::bigint AND lease_token = ${job.leaseToken}::uuid AND status = 'running'
    RETURNING id
  `)
  return getExecuteRows(result).length > 0
}

export type FailOutcome = 'retrying' | 'failed' | 'lease-lost'

/**
 * Report a handler failure.
 *
 * The retry decision uses the same `attempts < max_attempts` predicate the claim
 * and the reaper use, so a no-retry job cannot be retried through this path
 * either.
 */
export async function failJob(
  job: ClaimedJob,
  message: string,
  opts?: { backoffMs?: number }
): Promise<FailOutcome> {
  const backoffSecs = Math.max(0, opts?.backoffMs ?? 0) / 1000
  const result = await db.execute(sql`
    UPDATE job_queue
    SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
        run_at = CASE
                   WHEN attempts < max_attempts
                   THEN now() + make_interval(secs => ${backoffSecs})
                   ELSE run_at
                 END,
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END,
        last_error = ${message.slice(0, 4000)},
        updated_at = now()
    WHERE id = ${job.id}::bigint AND lease_token = ${job.leaseToken}::uuid AND status = 'running'
    RETURNING status
  `)
  const rows = getExecuteRows<{ status: string }>(result)
  if (rows.length === 0) return 'lease-lost'
  return rows[0].status === 'pending' ? 'retrying' : 'failed'
}

export interface ReapResult {
  /** Leases returned to `pending` because the job had attempts left. */
  requeued: number
  /** Leases made terminal because the job had none — the no-retry case. */
  terminated: number
}

/**
 * Reclaim leases whose owner died.
 *
 * The `attempts < max_attempts` split is the load-bearing line in this file. A
 * `maxAttempts = 1` job that was claimed has `attempts = 1`, so it lands in the
 * `terminated` branch and is never handed back — which is what stops a process
 * death from turning an at-most-once import into a double import.
 */
export async function reapExpiredLeases(): Promise<ReapResult> {
  const result = await db.execute(sql`
    UPDATE job_queue
    SET status = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END,
        last_error = CASE
          WHEN attempts < max_attempts
          THEN 'lease expired; requeued (attempt ' || attempts || ' of ' || max_attempts || ')'
          ELSE 'lease expired with no attempts remaining; not retried (max_attempts=' ||
               max_attempts || '). A retry here would re-run work that must run at most once.'
        END,
        updated_at = now()
    WHERE status = 'running' AND locked_until < now()
    RETURNING job_id, queue, status, attempts, max_attempts, locked_by
  `)

  const rows = getExecuteRows<{
    job_id: string
    queue: string
    status: string
    attempts: number
    max_attempts: number
    locked_by: string | null
  }>(result)

  const out: ReapResult = { requeued: 0, terminated: 0 }
  for (const row of rows) {
    if (row.status === 'pending') {
      out.requeued += 1
      log.warn(
        {
          jobId: row.job_id,
          queue: row.queue,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          lostBy: row.locked_by,
        },
        'expired lease requeued'
      )
    } else {
      out.terminated += 1
      log.error(
        {
          jobId: row.job_id,
          queue: row.queue,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          lostBy: row.locked_by,
        },
        'expired lease on a job with no attempts remaining — failed terminally, NOT retried'
      )
    }
  }
  return out
}

/**
 * Drop terminal rows older than `olderThanMs`.
 *
 * Retention has to outlive any dedupe key a scheduler will still emit, or a
 * pruned cron slot could be enqueued a second time. The scheduler only ever
 * emits the slot bracketing "now", so a multi-day window is many orders of
 * magnitude of slack.
 */
export async function pruneTerminalJobs(olderThanMs: number): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM job_queue
    WHERE status IN ('succeeded', 'failed')
      AND finished_at < now() - make_interval(secs => ${olderThanMs / 1000})
    RETURNING id
  `)
  return getExecuteRows(result).length
}

/** Counts by status, for the readiness payload and for tests. */
export async function jobQueueDepth(): Promise<Record<string, number>> {
  const result = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM job_queue GROUP BY status
  `)
  const rows = getExecuteRows<{ status: string; n: number }>(result)
  return Object.fromEntries(rows.map((r) => [r.status, r.n]))
}
