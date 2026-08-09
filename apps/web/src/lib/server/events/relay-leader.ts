/**
 * Outbox relay leader election, as a lease row in the tenant's own database.
 *
 * ## Why this replaced `pg_try_advisory_lock`
 *
 * The relay used to elect a leader with a session-level advisory lock on a
 * dedicated connection (`relay-lock.ts`). On a direct connection that is
 * correct. The reason it could not stay is that its correctness depends on
 * properties of the *session*, and every one of those properties was measured
 * to change once a pooler is in the path:
 *
 * - **it fails open, non-deterministically.** A second pooled client asking for
 *   the same key was told `t`, because the pooler had routed it onto the *same
 *   backend* and it therefore RE-ENTERED the lock (hold count 2). Forced onto a
 *   fresh backend the same call correctly returned `false`. So "did I win the
 *   election?" had an answer that depended on connection routing.
 * - **it outlives its client.** A pooled holder that disconnected kept the lock,
 *   and a direct client asking for it then *blocked* — measured dying twice on a
 *   10s `lock_timeout` and recovering only after `pg_terminate_backend`.
 * - **the pooler runs no reset between clients**, so session state set by one
 *   client is visible to the next.
 *
 * The relay tier terminates at the **direct** endpoint, so none of that applies
 * to it today. That is exactly the argument this module refuses to rely on: a
 * registry record whose `db_direct_url` is in fact a pooler is a one-character
 * mistake, and it would silently elect two leaders for one tenant rather than
 * failing. Correctness should not be one config field deep.
 *
 * ## What replaces it
 *
 * One row, one expiry, and **one statement** that both acquires and renews:
 *
 * ```
 * INSERT … ON CONFLICT (name) DO UPDATE … WHERE owner = me OR expires_at <= now()
 * ```
 *
 * `ON CONFLICT DO UPDATE` takes a row lock, so concurrent claimers serialize and
 * the loser re-evaluates the `WHERE` against the winner's committed row. There
 * is no session state, so the answer cannot depend on which backend the caller
 * landed on; a dead leader's lease lapses on its own; and a follower is told
 * `false` immediately rather than blocking behind a lock it will never get.
 *
 * ## The fence
 *
 * `fence` increments on **acquisition** and never on renewal, so it names a
 * leadership epoch. The relay carries the fence it was granted and re-checks it
 * on every renewal: a leader that stalled past its lease, was superseded, and
 * then resumed learns it lost — which is the case a lease alone cannot express.
 *
 * Draining is idempotent regardless (deterministic job ids, `published_at IS
 * NULL` as the read filter), so a lost fence costs a wasted pass and never a
 * double delivery. The fence is what makes "two replicas do not both drain one
 * tenant" an observable fact rather than an inference from idempotency.
 */
import { sql as raw } from 'drizzle-orm'
import { hostname } from 'os'
import { randomUUID } from 'crypto'
import type { Database } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

/** The only lease this table holds today. One row per tenant database. */
export const OUTBOX_LEASE = 'outbox'

/** Postgres `undefined_table` — the relay-leader migration has not run here. */
const UNDEFINED_TABLE = '42P01'

export class RelayLeaderTableMissingError extends Error {
  constructor(cause: unknown) {
    super(
      'outbox_relay_leader is absent in this database (migration 0256 not applied). ' +
        'The relay cannot elect a leader here.'
    )
    this.name = 'RelayLeaderTableMissingError'
    this.cause = cause
  }
}

export function isMissingRelayLeaderTable(err: unknown): boolean {
  const code =
    (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code
  return code === UNDEFINED_TABLE || err instanceof RelayLeaderTableMissingError
}

/**
 * Stable per-process identity. Two relay replicas on one host, or two in-process
 * tiers in a test, must be distinguishable — otherwise the `owner = me` renewal
 * branch would hand the second one the first one's lease.
 */
let ownerMemo: string | null = null
export function relayOwnerId(): string {
  if (!ownerMemo) ownerMemo = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  return ownerMemo
}

/** Test seam — a fresh identity makes two in-process tiers distinguishable. */
export function __resetRelayOwnerIdForTests(): void {
  ownerMemo = null
}

export interface RelayLease {
  owner: string
  /** Leadership epoch. Bumped on acquisition, never on renewal. */
  fence: string
  expiresAt: Date
}

interface LeaseRow {
  owner: string
  fence: string | number | bigint
  expires_at: Date | string
}

function toLease(row: LeaseRow): RelayLease {
  return {
    owner: row.owner,
    fence: String(row.fence),
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  }
}

/**
 * Acquire the lease, or renew it if this process already holds it.
 *
 * Returns `null` when another owner holds a live lease — the caller is a
 * follower and must not drain.
 *
 * @param db    the tenant's own database handle (the lease lives with the data)
 * @param ttlMs how long the lease is held before another replica may take it
 */
export async function claimRelayLease(
  db: Database,
  ttlMs: number,
  opts: { owner?: string; name?: string } = {}
): Promise<RelayLease | null> {
  const owner = opts.owner ?? relayOwnerId()
  const name = opts.name ?? OUTBOX_LEASE
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`relay lease ttlMs must be a positive number, received ${String(ttlMs)}`)
  }
  let result
  try {
    result = await db.execute(raw`
      INSERT INTO outbox_relay_leader (name, owner, fence, acquired_at, renewed_at, expires_at)
      VALUES (
        ${name},
        ${owner},
        1,
        now(),
        now(),
        now() + make_interval(secs => ${ttlMs / 1000}::double precision)
      )
      ON CONFLICT (name) DO UPDATE SET
        owner = EXCLUDED.owner,
        fence = outbox_relay_leader.fence
          + (CASE WHEN outbox_relay_leader.owner = EXCLUDED.owner THEN 0 ELSE 1 END),
        acquired_at = CASE
          WHEN outbox_relay_leader.owner = EXCLUDED.owner THEN outbox_relay_leader.acquired_at
          ELSE now()
        END,
        renewed_at = now(),
        expires_at = EXCLUDED.expires_at
      WHERE outbox_relay_leader.owner = EXCLUDED.owner
         OR outbox_relay_leader.expires_at <= now()
      RETURNING owner, fence, expires_at
    `)
  } catch (err) {
    if (isMissingRelayLeaderTable(err)) throw new RelayLeaderTableMissingError(err)
    throw err
  }
  const rows = getExecuteRows<LeaseRow>(result)
  if (rows.length === 0) return null
  return toLease(rows[0])
}

/**
 * Renew a lease this process believes it holds, refusing if the fence moved.
 *
 * The fence check is the difference between "my lease is still valid" and "I am
 * still the leader". A process that stalled past its expiry, had the lease taken
 * and then re-taken by itself would renew happily under an owner-only check
 * while another replica had already drained in between.
 */
export async function renewRelayLease(
  db: Database,
  held: RelayLease,
  ttlMs: number,
  opts: { name?: string } = {}
): Promise<RelayLease | null> {
  const fresh = await claimRelayLease(db, ttlMs, { owner: held.owner, name: opts.name })
  if (!fresh) return null
  if (fresh.fence !== held.fence) return null
  return fresh
}

/** Give up the lease so a follower takes over immediately rather than on expiry. */
export async function releaseRelayLease(
  db: Database,
  held: RelayLease,
  opts: { name?: string } = {}
): Promise<boolean> {
  const name = opts.name ?? OUTBOX_LEASE
  try {
    const result = await db.execute(raw`
      DELETE FROM outbox_relay_leader
      WHERE name = ${name} AND owner = ${held.owner} AND fence = ${Number(held.fence)}
      RETURNING owner
    `)
    return getExecuteRows(result).length > 0
  } catch (err) {
    if (isMissingRelayLeaderTable(err)) return false
    throw err
  }
}

/** Diagnostics only: who holds the lease right now, if anyone. */
export async function readRelayLease(
  db: Database,
  opts: { name?: string } = {}
): Promise<RelayLease | null> {
  const name = opts.name ?? OUTBOX_LEASE
  const result = await db.execute(raw`
    SELECT owner, fence, expires_at
    FROM outbox_relay_leader
    WHERE name = ${name} AND expires_at > now()
  `)
  const rows = getExecuteRows<LeaseRow>(result)
  return rows.length === 0 ? null : toLease(rows[0])
}
