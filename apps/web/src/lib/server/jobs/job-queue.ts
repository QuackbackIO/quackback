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
 * ## Where the statements live
 *
 * The claim/heartbeat/complete/fail/reap statements moved to `lease.ts` so the
 * fleet migrator's claim loop is the same primitive rather than a second one
 * (SAAS-HOSTING-STACK.md §10.3: *"Fleet migration is its second consumer, not a
 * new subsystem"*). Nothing about the semantics moved with them — this file
 * still owns the queue's shape, the workspace assertion and the enqueue path, and
 * the kill-matrix proof still runs through here, which is what keeps `lease.ts`
 * honest.
 *
 * ## The workspace assertion
 *
 * The queue is per-workspace because the table lives in the workspace's own database —
 * there is no shared queue to route out of. That is a structural property, but
 * §3's whole point is that a wrong-workspace answer passes every other check in the
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
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { noteDurableWork, SINGLE_WORKSPACE_KEY } from '@/lib/server/workspaces/after-commit'
import {
  leaseClaimGroupedSql,
  leaseCompleteSql,
  leaseFailSql,
  leaseHeartbeatSql,
  leaseReapSql,
  leaseTerminateSql,
} from './lease'

const log = logger.child({ component: 'job-queue' })

/** The table the lease statements operate on. */
const TABLE = 'job_queue'

/** Postgres `undefined_table`. The workspace has not run migration 0253 yet. */
export const UNDEFINED_TABLE = '42P01'

export class JobQueueMissingError extends Error {
  constructor() {
    super(
      'job_queue does not exist in this database. Migration 0253 has not been applied here; ' +
        'the queue tier skips this workspace rather than crash-looping (expand lands before the ' +
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

/**
 * The earliest instant this workspace's queue has work waiting for.
 *
 * Read by the tier on the connection it is **about to drop**, which is the point
 * of it: a tier that goes idle has to know when to come back, and the only
 * honest answer is the one the database gives before the lights go out. Without
 * this a delayed job — a hook retry five minutes out, a scheduled publish —
 * would sit until whatever generic rescan happened to fire, turning "runs at
 * 14:05" into "runs some time after 14:05".
 *
 * Null means nothing is pending at all, which is the only state in which the
 * tier may sleep on its safety-net interval alone. A row already due comes back
 * as a past timestamp rather than as null, and the caller treats that as "wake
 * immediately" — the fail-safe direction, since the alternative is a due job
 * that nobody is coming back for.
 */
export async function earliestPendingJobAt(): Promise<Date | null> {
  const result = await db.execute(sql`
    SELECT min(run_at) AS run_at FROM job_queue WHERE status = 'pending'
  `)
  const rows = getExecuteRows<{ run_at: Date | string | null }>(result)
  const value = rows[0]?.run_at ?? null
  return value === null ? null : asDate(value)
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
  /**
   * Caller's transaction (or any drizzle executor). When set, the INSERT
   * participates in that transaction: a rollback leaves no job row, and this
   * function does not fire the HTTP nudge (NOTIFY from the job_queue trigger
   * is commit-gated). Omit for the historical auto-commit path.
   */
  executor?: JobSqlExecutor
}

/** Narrow enough for `db` and a drizzle transaction. */
export type JobSqlExecutor = {
  execute: (query: unknown) => Promise<unknown>
}

export interface EnqueueJobResult {
  jobId: string
  /** False when `dedupeKey` already existed, so nothing was written. */
  inserted: boolean
}

/** A found row, for callers that need to know whether a job still exists. */
export interface JobLookup {
  jobId: string
  queue: string
  status: string
  runAt: Date
  attempts: number
  maxAttempts: number
}

/** The subset of a claimed row a handler and the lease writes need. */
export interface ClaimedJob {
  id: string
  jobId: string
  queue: string
  /**
   * The idempotency handle this row was enqueued under, when it had one.
   *
   * Handlers that dedupe their own side effects need it: the reference passed
   * BullMQ's `job.id` into `hook.run`, and for relay-enqueued hooks that id was
   * the deterministic `<eventId>:<sink>:<target>` key. That key is this column.
   */
  dedupeKey: string | null
  payload: Record<string, unknown>
  workspaceKey: string | null
  attempts: number
  maxAttempts: number
  leaseToken: string
  lockedUntil: Date
}

interface ClaimRow {
  id: string | number | bigint
  job_id: string
  queue: string
  dedupe_key: string | null
  payload: Record<string, unknown> | null
  workspace_key: string | null
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

function currentWorkspaceKey(): string | null {
  return getCurrentWorkspace()?.workspaceKey ?? null
}

/** Workspace the after-commit scheduler should ring for this insert. */
function workKeyForSignal(): string | null {
  return currentWorkspaceKey() ?? (isPooledTenancy() ? null : SINGLE_WORKSPACE_KEY)
}

function noteInsertedWork(executor?: JobSqlExecutor): void {
  noteDurableWork(workKeyForSignal(), { committed: !executor })
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Put a job on this workspace's queue.
 *
 * `workspace_key` is stamped from the ambient scope, which is also what the claim
 * asserts against. There is no way to enqueue for a different workspace, because
 * there is no shared queue and no workspace parameter — you would have to open that
 * workspace's scope, at which point you are writing into its own database.
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const jobId = generateId('job')
  const maxAttempts = input.maxAttempts ?? 1
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be an integer >= 1, received ${String(input.maxAttempts)}`)
  }

  const executor = input.executor ?? db
  const result = await executor.execute(sql`
    INSERT INTO job_queue (job_id, queue, dedupe_key, workspace_key, payload, run_at, max_attempts)
    VALUES (
      ${jobId},
      ${input.queue},
      ${input.dedupeKey ?? null},
      ${currentWorkspaceKey()},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${input.runAt ? input.runAt.toISOString() : sql`now()`},
      ${maxAttempts}
    )
    ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING job_id
  `)

  const rows = getExecuteRows<{ job_id: string }>(result)
  const inserted = rows.length > 0
  // Transactional inserts record the workspace and flush only after the
  // outer commit. Auto-commit inserts are already visible, so they signal now.
  if (inserted) noteInsertedWork(input.executor)
  return { jobId, inserted }
}

/** How many rows one queue may have claimed in a pass, and for how long. */
export interface QueueClaimSpec {
  queue: string
  /** Free slots for this queue right now. A queue at capacity is left out. */
  limit: number
  /** How long the claim holds a row from this queue before the reaper may take it. */
  leaseMs: number
}

/**
 * Enqueue many jobs in one statement, deduplicating on `dedupeKey`.
 *
 * This is the outbox relay's shape (`enqueueHookJobsWithIds`): it re-drains a
 * row after a crash and re-enqueues the SAME deterministic keys, and the fact
 * that a second enqueue is a no-op is what makes delivery effectively-once.
 * `ON CONFLICT DO NOTHING` gives that, including for duplicates *within* one
 * call — unlike `DO UPDATE`, which errors when a command touches a row twice.
 *
 * Returns the keys that were actually written, so a caller can tell a fresh
 * enqueue from a re-drain.
 */
export async function enqueueJobs(
  inputs: readonly EnqueueJobInput[],
  opts?: { executor?: JobSqlExecutor }
): Promise<{ inserted: number; insertedDedupeKeys: string[] }> {
  if (inputs.length === 0) return { inserted: 0, insertedDedupeKeys: [] }

  const rows = inputs.map((input) => {
    const maxAttempts = input.maxAttempts ?? 1
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error(`maxAttempts must be an integer >= 1, received ${String(input.maxAttempts)}`)
    }
    return {
      job_id: generateId('job'),
      queue: input.queue,
      dedupe_key: input.dedupeKey ?? null,
      payload: input.payload ?? {},
      run_at: (input.runAt ?? new Date()).toISOString(),
      max_attempts: maxAttempts,
    }
  })

  const executor = opts?.executor ?? db
  const result = await executor.execute(sql`
    INSERT INTO job_queue (job_id, queue, dedupe_key, workspace_key, payload, run_at, max_attempts)
    SELECT x.job_id, x.queue, x.dedupe_key, ${currentWorkspaceKey()}, x.payload, x.run_at, x.max_attempts
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
      job_id text, queue text, dedupe_key text, payload jsonb,
      run_at timestamptz, max_attempts int
    )
    ON CONFLICT (queue, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING dedupe_key
  `)
  const written = getExecuteRows<{ dedupe_key: string | null }>(result)
  if (written.length > 0) noteInsertedWork(opts?.executor)
  return {
    inserted: written.length,
    insertedDedupeKeys: written.map((r) => r.dedupe_key).filter((k): k is string => k !== null),
  }
}

/**
 * Cancel a job by its dedupe key, so the key is free to be scheduled again.
 *
 * The reference for this is BullMQ's `job.remove()`, which the scheduler uses
 * to move a delayed job (a changelog publish that was re-dated, a maintenance
 * window that shifted). A *running* row is deliberately not removable: its
 * handler is mid-flight and the fencing token is what adjudicates its result.
 * Everything else — pending, and terminal rows still occupying the key —
 * is deleted, because under BullMQ `removeOnComplete` had already freed the id
 * and a caller that could not re-schedule a key it had already used would be a
 * silent behaviour change.
 *
 * Returns how many rows were removed.
 */
export async function cancelJob(queue: string, dedupeKey: string): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM job_queue
    WHERE queue = ${queue} AND dedupe_key = ${dedupeKey} AND status <> 'running'
    RETURNING id
  `)
  return getExecuteRows(result).length
}

/**
 * Look a job up by its dedupe key.
 *
 * The workflow sweeper's orphan pass needs exactly this: "does the durable
 * timer for this parked run still exist, and in what state?". Under BullMQ that
 * was `queue.getJob(id)` plus `job.getState()`.
 */
export async function findJobByDedupeKey(
  queue: string,
  dedupeKey: string
): Promise<JobLookup | null> {
  const result = await db.execute(sql`
    SELECT job_id, queue, status, run_at, attempts, max_attempts
    FROM job_queue
    WHERE queue = ${queue} AND dedupe_key = ${dedupeKey}
    LIMIT 1
  `)
  const rows = getExecuteRows<{
    job_id: string
    queue: string
    status: string
    run_at: Date | string
    attempts: number
    max_attempts: number
  }>(result)
  if (rows.length === 0) return null
  const row = rows[0]
  return {
    jobId: row.job_id,
    queue: row.queue,
    status: row.status,
    runAt: asDate(row.run_at),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  }
}

export interface ClaimJobsInput {
  specs: readonly QueueClaimSpec[]
}

/**
 * Claim runnable jobs, in one short transaction, respecting a per-queue cap.
 *
 * `attempts` is incremented here. That placement is the whole at-most-once
 * property — see the module header before moving it.
 *
 * **Why the cap is per queue rather than one number for the pass.** The
 * reference gave every queue its own BullMQ `Worker` with its own
 * `concurrency`, so a slow queue could not consume another's capacity and a
 * long lock on one queue did not lengthen anyone else's. A single `LIMIT` over
 * a union of queues loses both properties: `help-center-translate`'s 120s lease
 * would be applied to a `snooze-sweep` row claimed in the same batch, and one
 * queue's backlog would fill the batch. The `LATERAL` below is what restores
 * them — one query per pass regardless of queue count, but each queue's own
 * limit and its own lease.
 */
export async function claimJobs(input: ClaimJobsInput): Promise<ClaimedJob[]> {
  const runnable = input.specs.filter((s) => s.limit >= 1)
  if (runnable.length === 0) return []

  // A JSON object rather than Postgres array literals: Drizzle's `sql` template
  // flattens a JS array into one parameter per element, so `= ANY($1::text[])`
  // arrives as a bare string and Postgres rejects it as a malformed array. This
  // shape parameterises cleanly and leaves the value opaque to the parser.
  const result = await db.execute(
    leaseClaimGroupedSql({
      table: TABLE,
      groupColumn: 'queue',
      groups: Object.fromEntries(
        runnable.map((s) => [s.queue, { limit: s.limit, leaseMs: s.leaseMs }])
      ),
      workerId: jobWorkerId(),
      returning: sql`j.id, j.job_id, j.queue, j.dedupe_key, j.payload, j.workspace_key,
              j.attempts, j.max_attempts, j.lease_token, j.locked_until`,
    })
  )

  // The UPDATE's RETURNING order is unspecified. Sorting by id restores the
  // enqueue order the LATERAL selected in, so a caller that runs the batch
  // serially runs it oldest-first rather than in whatever order the executor
  // produced.
  const rows = getExecuteRows<ClaimRow>(result).sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0
  )
  const expected = currentWorkspaceKey()
  const claimed: ClaimedJob[] = []

  for (const row of rows) {
    const job: ClaimedJob = {
      id: String(row.id),
      jobId: row.job_id,
      queue: row.queue,
      dedupeKey: row.dedupe_key,
      payload: row.payload ?? {},
      workspaceKey: row.workspace_key,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      leaseToken: row.lease_token,
      lockedUntil: asDate(row.locked_until),
    }

    if (job.workspaceKey !== expected) {
      // Refuse loudly and terminally. This row is not another workspace's job —
      // it is a corrupt row in THIS workspace's database — but running it would be
      // a cross-workspace execution, which is the one outcome the whole design
      // exists to make impossible.
      log.error(
        {
          jobId: job.jobId,
          queue: job.queue,
          rowWorkspaceKey: job.workspaceKey,
          scopeWorkspaceKey: expected,
        },
        'job REFUSED: row workspace does not match the workspace scope that claimed it'
      )
      await terminate(
        job,
        `workspace mismatch: row is stamped ${job.workspaceKey ?? 'null'}, scope is ${expected ?? 'null'}`
      )
      continue
    }

    claimed.push(job)
  }

  return claimed
}

/** Terminal-fail a job outright, bypassing the retry decision. */
async function terminate(job: ClaimedJob, reason: string): Promise<void> {
  await db.execute(leaseTerminateSql(TABLE, job, reason))
}

/**
 * Extend a lease while the handler is still working.
 *
 * Returns false when the lease is gone — the job was reaped and possibly handed
 * to another worker. A handler that gets false should stop: anything it writes
 * from here is racing whoever holds the job now.
 */
export async function heartbeatJob(job: ClaimedJob, leaseMs: number): Promise<boolean> {
  const result = await db.execute(leaseHeartbeatSql(TABLE, job, leaseMs))
  return getExecuteRows(result).length > 0
}

/** Mark a job done. False means the lease was lost and nothing was written. */
export async function completeJob(job: ClaimedJob): Promise<boolean> {
  const result = await db.execute(leaseCompleteSql(TABLE, job))
  return getExecuteRows(result).length > 0
}

export type FailOutcome = 'retrying' | 'failed' | 'lease-lost'

/**
 * Report a handler failure.
 *
 * The retry decision uses the same `attempts < max_attempts` predicate the claim
 * and the reaper use, so a no-retry job cannot be retried through this path
 * either.
 *
 * `terminal` is the reference's `UnrecoverableError`: a failure the handler
 * knows retrying cannot fix (an unknown hook type, a deleted segment). It is
 * ANDed into the retry predicate rather than replacing it, so it can only ever
 * make a job *more* terminal — there is no value of `terminal` that lets a
 * spent job back into `pending`.
 */
export async function failJob(
  job: ClaimedJob,
  message: string,
  opts?: { backoffMs?: number; terminal?: boolean }
): Promise<FailOutcome> {
  const result = await db.execute(leaseFailSql(TABLE, job, message, opts))
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
  // The reaper's RETURNING is the lease's, plus this queue's own two columns
  // for the log line. Widening it here rather than re-writing the statement is
  // what keeps the reaper single-sourced.
  const result = await db.execute(leaseReapSql(TABLE, sql`j.job_id, j.queue`))

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
export async function pruneTerminalJobs(
  olderThanMs: number,
  perQueueMs: Readonly<Record<string, { succeeded?: number; failed?: number }>> = {}
): Promise<number> {
  // Per-queue, per-status overrides exist because the reference set retention
  // that way, and the asymmetry was deliberate: `{event-hooks}` kept completed
  // jobs 24h and failed ones 30 days, so *"did this webhook actually fire?"*
  // stays answerable long after the successful traffic has been discarded. One
  // fleet-wide window either bloats the highest-volume queue's table or throws
  // away the diagnostic history the low-volume ones were keeping on purpose.
  const overrides = JSON.stringify(
    Object.fromEntries(
      Object.entries(perQueueMs).map(([queue, byStatus]) => [
        queue,
        Object.fromEntries(
          Object.entries(byStatus)
            .filter(([, ms]) => typeof ms === 'number')
            .map(([status, ms]) => [status, (ms as number) / 1000])
        ),
      ])
    )
  )
  const result = await db.execute(sql`
    DELETE FROM job_queue
    WHERE status IN ('succeeded', 'failed')
      AND finished_at < now() - make_interval(
        secs => COALESCE(
          (${overrides}::jsonb -> queue ->> status)::numeric,
          ${olderThanMs / 1000}
        )
      )
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
