/**
 * The lease primitive itself, with the table it operates on as a parameter.
 *
 * `job-queue.ts` is the consumer today, against the tenant's own `job_queue`
 * table. The statements live here, keyed by table, so a second queue-shaped
 * consumer shares them rather than reimplementing them. Two consumers could
 * never share a *function* — they would run against different databases with
 * different row shapes. They can share the statements, and the statements
 * are where every load-bearing property lives:
 *
 * 1. **`attempts` is incremented by the CLAIM**, never by completion. A row
 *    with `max_attempts = 1` that was claimed even once already reads
 *    `attempts = 1`, so it is spent whether or not anything reported back.
 * 2. **`attempts < max_attempts` gates the claim *and* the reaper's requeue.**
 *    A spent row is not claimable and is not requeueable; an expired lease on
 *    one becomes terminal `failed` with a named reason.
 * 3. **Every write after the claim is guarded by `lease_token`.** A process
 *    that stalls past its lease, is reaped, then resumes and reports success
 *    updates zero rows and is told its lease was lost.
 *
 * Those three were proved on `job_queue` in a one-off kill-matrix run — 70
 * SIGKILLs at uniformly random instants and 4 concurrent reapers against 4
 * concurrent drainers, zero double executions, with a positive control
 * (`maxAttempts: 3`) establishing that the harness could see a double when
 * there is one. **Because the statements now live here, that proof covers this
 * module**, and breaking anything below turns `__tests__/job-queue.test.ts`
 * red. A second implementation would have inherited none of it.
 *
 * ## What a consumer must provide
 *
 * A table with these columns, and the shape `CHECK` that makes a NULL
 * `locked_until` impossible to read as "expired":
 *
 * ```
 * id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
 * status text          -- 'pending' | 'running' | 'succeeded' | 'failed'
 * run_at timestamptz   attempts int   max_attempts int
 * lease_token uuid     locked_until timestamptz   locked_by text
 * last_error text      started_at / finished_at / updated_at timestamptz
 * CHECK ((status = 'running') = (lease_token IS NOT NULL AND locked_until IS NOT NULL))
 * ```
 */
import { sql, type SQL } from 'drizzle-orm'

/** Reason text the reaper writes, so both consumers say the same thing. */
export const REAP_REQUEUED_REASON = 'lease expired; requeued (attempt '
export const REAP_TERMINAL_REASON = 'lease expired with no attempts remaining; not retried'

export interface LeaseClaimGroupInput {
  /** Table holding the leased rows. A module constant, never input. */
  table: string
  /**
   * Column whose value partitions the table into independently-capped groups.
   * `job_queue` groups by `queue`.
   */
  groupColumn: string
  /**
   * Per-group cap and lease, keyed by the group's value. A group at capacity is
   * simply absent from this object and is not visited.
   */
  groups: Readonly<Record<string, { limit: number; leaseMs: number }>>
  /** Stable per-process identity, written to `locked_by`. */
  workerId: string
  /** Columns to return, qualified with the `j` alias. */
  returning: SQL
}

/**
 * The three universal claimability predicates, in one place.
 *
 * Unqualified on purpose: both claim shapes below arrange for the leased table
 * to be the only relation in scope carrying these columns, so there is one
 * spelling of the `attempts < max_attempts` barrier rather than two that can
 * drift apart.
 */
const CLAIMABLE = sql`status = 'pending'
        AND run_at <= now()
        -- The second barrier. A spent row must not be claimable even if some
        -- other writer put it back to pending; see the module header.
        AND attempts < max_attempts`

/**
 * The claim's write half, shared by both shapes.
 *
 * `attempts` is incremented here. That placement is the whole at-most-once
 * property — read the module header before moving it. `lockedUntil` is the only
 * thing the two shapes disagree about: one lease for the pass, or the claimed
 * row's own group lease carried out of the CTE.
 */
function leaseStamp(table: string, lockedUntil: SQL, workerId: string, returning: SQL): SQL {
  return sql`
    UPDATE ${sql.identifier(table)} j
    SET status = 'running',
        attempts = j.attempts + 1,
        lease_token = gen_random_uuid(),
        locked_until = ${lockedUntil},
        locked_by = ${workerId},
        started_at = COALESCE(j.started_at, now()),
        updated_at = now()
    FROM claimable c
    WHERE j.id = c.id
    RETURNING ${returning}
  `
}

/**
 * Claim runnable rows with a cap and a lease *per group*, still in one pass.
 *
 * **Why the cap is per group rather than one number for the pass.** Each queue
 * used to get its own worker with its own concurrency, so a slow queue could
 * not consume another's capacity and a long lock on one queue did not lengthen
 * anyone else's. A single `LIMIT` over a union of queues loses both properties:
 * `help-center-translate`'s 120s lease would be applied to a `snooze-sweep` row
 * claimed in the same batch, and one queue's backlog would fill the batch. The
 * `LATERAL` below is what restores them — one query per pass regardless of
 * group count, but each group's own limit and its own lease.
 *
 * The group table arrives as a JSON object rather than Postgres array literals:
 * Drizzle's `sql` template flattens a JS array into one parameter per element,
 * so `= ANY($1::text[])` arrives as a bare string and Postgres rejects it as a
 * malformed array. This shape parameterises cleanly and leaves the value opaque
 * to the parser. Its columns are named `grp`/`lim`/`lease_secs` so no group
 * column can collide with the leased table's own, which is what keeps
 * `CLAIMABLE` above spellable unqualified.
 */
export function leaseClaimGroupedSql(input: LeaseClaimGroupInput): SQL {
  const table = sql.identifier(input.table)
  const column = sql.identifier(input.groupColumn)
  const spec = JSON.stringify(
    Object.fromEntries(
      Object.entries(input.groups).map(([group, g]) => [
        group,
        { limit: g.limit, leaseSecs: g.leaseMs / 1000 },
      ])
    )
  )
  return sql`
    WITH spec AS (
      SELECT key AS grp,
             (value->>'limit')::int AS lim,
             (value->>'leaseSecs')::numeric AS lease_secs
      FROM jsonb_each(${spec}::jsonb)
    ),
    claimable AS (
      SELECT g.id, s.lease_secs
      FROM spec s
      CROSS JOIN LATERAL (
        SELECT id
        FROM ${table}
        WHERE ${column} = s.grp
          AND ${CLAIMABLE}
        ORDER BY run_at, id
        LIMIT s.lim
        FOR UPDATE SKIP LOCKED
      ) g
    )
    ${leaseStamp(
      input.table,
      sql`now() + make_interval(secs => c.lease_secs)`,
      input.workerId,
      input.returning
    )}
  `
}

export interface LeaseHandle {
  id: string
  leaseToken: string
}

/**
 * Extend a lease while the handler is still working.
 *
 * Returns rows only while the lease is still held; zero rows means the row was
 * reaped and possibly handed to another worker, and anything the caller writes
 * from that point is racing whoever holds it now.
 */
export function leaseHeartbeatSql(table: string, handle: LeaseHandle, leaseMs: number): SQL {
  return sql`
    UPDATE ${sql.identifier(table)}
    SET locked_until = now() + make_interval(secs => ${leaseMs / 1000}),
        updated_at = now()
    WHERE ${fence(handle)}
    RETURNING id
  `
}

/** Mark a leased row done. Zero rows means the lease was lost and nothing was written. */
export function leaseCompleteSql(table: string, handle: LeaseHandle): SQL {
  return sql`
    UPDATE ${sql.identifier(table)}
    SET status = 'succeeded',
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE ${fence(handle)}
    RETURNING id
  `
}

/**
 * Report a handler failure.
 *
 * The retry decision uses the same `attempts < max_attempts` predicate the
 * claim and the reaper use, so a no-retry row cannot be retried through this
 * path either. Returns the resulting `status`, or zero rows if the lease was
 * lost.
 *
 * `terminal` is a failure the handler knows retrying cannot fix (an unknown
 * hook type, a deleted segment). It is ANDed into the retry predicate rather
 * than replacing it, so it can only ever make a row *more* terminal — there is
 * no value of `terminal` that lets a spent row back into `pending`.
 */
export function leaseFailSql(
  table: string,
  handle: LeaseHandle,
  message: string,
  opts?: { backoffMs?: number; terminal?: boolean }
): SQL {
  const backoffSecs = Math.max(0, opts?.backoffMs ?? 0) / 1000
  const retryable = opts?.terminal ? sql`false` : sql`attempts < max_attempts`
  return sql`
    UPDATE ${sql.identifier(table)}
    SET status = CASE WHEN ${retryable} THEN 'pending' ELSE 'failed' END,
        run_at = CASE
                   WHEN ${retryable}
                   THEN now() + make_interval(secs => ${backoffSecs})
                   ELSE run_at
                 END,
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = CASE WHEN ${retryable} THEN NULL ELSE now() END,
        last_error = ${message.slice(0, 4000)},
        updated_at = now()
    WHERE ${fence(handle)}
    RETURNING status
  `
}

/** Terminal-fail a leased row outright, bypassing the retry decision. */
export function leaseTerminateSql(table: string, handle: LeaseHandle, reason: string): SQL {
  return sql`
    UPDATE ${sql.identifier(table)}
    SET status = 'failed',
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = now(),
        last_error = ${reason},
        updated_at = now()
    WHERE ${fence(handle)}
  `
}

/**
 * Reclaim leases whose owner died.
 *
 * The `attempts < max_attempts` split is the load-bearing line. A
 * `max_attempts = 1` row that was claimed has `attempts = 1`, so it lands in
 * the terminal branch and is never handed back — which is what stops a process
 * death from turning an at-most-once import into a double import, or a
 * half-finished tenant migration into an unbounded retry loop.
 *
 * `RETURNING` names the columns both consumers log. `extraReturning` appends a
 * consumer's own columns — widening the one reaper rather than writing a
 * second, which is where the `attempts` predicate would get retyped and
 * eventually retyped wrong.
 */
export function leaseReapSql(table: string, extraReturning?: SQL): SQL {
  const t = sql.identifier(table)
  const extra = extraReturning ? sql`, ${extraReturning}` : sql``
  // `locked_by` is read in a CTE rather than from `RETURNING`, because
  // `RETURNING` reports POST-update values and this statement sets `locked_by`
  // to NULL — so the log line naming who lost the lease always said `null`.
  // Measured on a real reaped tenant, not inferred. The outer WHERE repeats the
  // predicate so the CTE's snapshot cannot let a second reaper act on a row the
  // first has already adjudicated.
  return sql`
    WITH expired AS (
      SELECT id, locked_by AS lost_by
      FROM ${t}
      WHERE status = 'running' AND locked_until < now()
    )
    UPDATE ${t} j
    SET status = CASE WHEN j.attempts < j.max_attempts THEN 'pending' ELSE 'failed' END,
        lease_token = NULL,
        locked_until = NULL,
        locked_by = NULL,
        finished_at = CASE WHEN j.attempts < j.max_attempts THEN NULL ELSE now() END,
        last_error = CASE
          WHEN j.attempts < j.max_attempts
          THEN ${REAP_REQUEUED_REASON} || j.attempts || ' of ' || j.max_attempts || ')'
          ELSE ${REAP_TERMINAL_REASON} || ' (max_attempts=' || j.max_attempts ||
               '). A retry here would re-run work that must run at most once.'
        END,
        updated_at = now()
    FROM expired e
    WHERE j.id = e.id AND j.status = 'running' AND j.locked_until < now()
    RETURNING j.id, j.status, j.attempts, j.max_attempts, e.lost_by AS locked_by${extra}
  `
}

/**
 * The fencing predicate, in one place.
 *
 * Every post-claim write is guarded by row id **and** lease token **and**
 * `status = 'running'`. Dropping any of the three is how a reaped owner
 * overwrites its successor, so the three travel together rather than being
 * retyped at five call sites.
 */
function fence(handle: LeaseHandle): SQL {
  return sql`id = ${handle.id}::bigint AND lease_token = ${handle.leaseToken}::uuid AND status = 'running'`
}
