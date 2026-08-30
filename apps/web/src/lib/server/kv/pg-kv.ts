/**
 * The Redis primitives the application half used, as single Postgres statements.
 *
 * GET/SET/DEL, SET NX EX, SADD + EXPIRE NX, INCR + EXPIRE NX. Nothing here is a
 * general key-value store; it is exactly the operations `redis.ts`,
 * `redis-rate-bucket.ts` and `signin-device-tracker.ts` issued, ported one for
 * one so the callers' semantics do not have to be re-reasoned.
 *
 * ## Three properties every statement below holds
 *
 * **One statement, therefore atomic.** Redis is single-threaded, so INCR and
 * SET NX are indivisible for free. A Postgres statement gets the same guarantee
 * from being a statement: `INSERT … ON CONFLICT DO UPDATE` takes the row lock
 * and the CASE arms evaluate under it. Split any of these into a read followed
 * by a write and you have reintroduced the race the Redis version did not have.
 *
 * **One round trip.** The round trip, not the statement, is the whole cost of
 * moving these paths onto Postgres (measured in `KV.md`), and it is why none of
 * these is expressed as a transaction with two statements in it.
 *
 * **The workspace is in the key.** `currentWorkspaceNamespace()` is the same function
 * that built the `t:<workspaceKey>:` prefix on the Redis wire key, so the
 * discriminator is not merely equivalent — it is the same value, moved from a
 * string prefix into a key column. Under pooled tenancy the row is additionally
 * in the workspace's own database. See `0251_pg_kv_presence_realtime.sql`.
 *
 * ## Expiry
 *
 * Every read carries `expires_at > now()`. An expired row is invisible the
 * instant it expires, whether or not `sweep.ts` has run. The sweeper reclaims
 * space and never decides correctness.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { currentWorkspaceNamespace } from '@/lib/server/workspaces/workspace-keyed'

/**
 * Reject a TTL that Postgres would accept and Redis would not.
 *
 * `SET … EX 0` is an error in Redis; here it would write a row that is already
 * expired, which reads as a silent no-op. Fail loudly instead — a lock with a
 * zero TTL is never taken and would look like unexplained contention.
 */
function ttlSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ttl must be a positive number of seconds, received ${String(seconds)}`)
  }
  return seconds
}

// ============================================================================
// Single values — GET / SET / DEL
// ============================================================================

/** GET. Returns null for a missing or expired key. */
export async function kvGet<T>(key: string): Promise<T | null> {
  const result = await db.execute(sql`
    SELECT value FROM kv_store
    WHERE workspace_key = ${currentWorkspaceNamespace()} AND key = ${key} AND expires_at > now()
  `)
  const rows = getExecuteRows<{ value: T }>(result)
  return rows.length > 0 ? rows[0].value : null
}

/** SET … EX. Overwrites value and TTL unconditionally, as Redis does. */
export async function kvSet(key: string, value: unknown, seconds: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO kv_store (workspace_key, key, value, expires_at)
    VALUES (
      ${currentWorkspaceNamespace()},
      ${key},
      ${JSON.stringify(value ?? null)}::jsonb,
      now() + make_interval(secs => ${ttlSeconds(seconds)})
    )
    ON CONFLICT (workspace_key, key) DO UPDATE
      SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
  `)
}

/** DEL. Variadic like the Redis helper it replaces; a no-op on an empty list. */
export async function kvDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await db.execute(sql`
    DELETE FROM kv_store
    WHERE workspace_key = ${currentWorkspaceNamespace()}
      AND key IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
  `)
}

/**
 * SET … EX … NX. True iff this caller took the key.
 *
 * The `WHERE` on the conflict arm is what makes an *expired* holder lose it: a
 * row past its TTL is not a holder, so the update fires and the row is returned.
 * A live holder matches nothing, no row comes back, and the caller is told it
 * lost. That is Redis's NX against a key whose TTL has elapsed, exactly.
 */
export async function kvSetNx(key: string, value: unknown, seconds: number): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO kv_store (workspace_key, key, value, expires_at)
    VALUES (
      ${currentWorkspaceNamespace()},
      ${key},
      ${JSON.stringify(value ?? null)}::jsonb,
      now() + make_interval(secs => ${ttlSeconds(seconds)})
    )
    ON CONFLICT (workspace_key, key) DO UPDATE
      SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
      WHERE kv_store.expires_at <= now()
    RETURNING key
  `)
  return getExecuteRows<{ key: string }>(result).length > 0
}

/**
 * SET NX followed by GET, collapsed into one statement.
 *
 * The Redis original (`visitor-hash.ts`) issued both and relied on "whoever won
 * NX, everyone then reads the same value". Two round trips became one, and the
 * read can no longer observe a value the write did not intend: a concurrent
 * writer either loses the conflict and reads the winner's value, or takes an
 * expired row and returns its own.
 */
export async function kvGetOrCreate<T>(key: string, create: T, seconds: number): Promise<T> {
  const result = await db.execute(sql`
    INSERT INTO kv_store (workspace_key, key, value, expires_at)
    VALUES (
      ${currentWorkspaceNamespace()},
      ${key},
      ${JSON.stringify(create)}::jsonb,
      now() + make_interval(secs => ${ttlSeconds(seconds)})
    )
    ON CONFLICT (workspace_key, key) DO UPDATE
      SET value = CASE WHEN kv_store.expires_at <= now() THEN EXCLUDED.value ELSE kv_store.value END,
          expires_at = CASE WHEN kv_store.expires_at <= now() THEN EXCLUDED.expires_at ELSE kv_store.expires_at END
    RETURNING value
  `)
  const rows = getExecuteRows<{ value: T }>(result)
  // ON CONFLICT DO UPDATE always produces a row, so this is unreachable in
  // practice; returning the caller's own value is still the right fallback.
  return rows.length > 0 ? rows[0].value : create
}

// ============================================================================
// Sets — the one Redis SET we used, `user:devices:<userId>`
// ============================================================================

/**
 * SADD + EXPIRE NX, as one statement. True iff the member was not already
 * present and live — i.e. Redis's `SADD` reply of 1.
 *
 * An expired member is not present, so it is re-claimed and its expiry
 * refreshed. That matches Redis, where the whole set would already have been
 * dropped by its TTL.
 */
export async function kvSetMemberClaim(
  setKey: string,
  member: string,
  seconds: number
): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO kv_set_member (workspace_key, set_key, member, expires_at)
    VALUES (
      ${currentWorkspaceNamespace()},
      ${setKey},
      ${member},
      now() + make_interval(secs => ${ttlSeconds(seconds)})
    )
    ON CONFLICT (workspace_key, set_key, member) DO UPDATE
      SET expires_at = EXCLUDED.expires_at
      WHERE kv_set_member.expires_at <= now()
    RETURNING member
  `)
  return getExecuteRows<{ member: string }>(result).length > 0
}

/** EXPIRE on the whole set: slide every live member's window forward. */
export async function kvSetTouch(setKey: string, seconds: number): Promise<void> {
  await db.execute(sql`
    UPDATE kv_set_member
    SET expires_at = now() + make_interval(secs => ${ttlSeconds(seconds)})
    WHERE workspace_key = ${currentWorkspaceNamespace()} AND set_key = ${setKey}
  `)
}

/** SREM. */
export async function kvSetMemberRemove(setKey: string, member: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM kv_set_member
    WHERE workspace_key = ${currentWorkspaceNamespace()} AND set_key = ${setKey} AND member = ${member}
  `)
}

// ============================================================================
// Rate buckets — INCR + EXPIRE NX
// ============================================================================

export interface BucketIncrement {
  key: string
  windowSeconds: number
}

export interface BucketState {
  /** Post-increment count for this window. */
  count: number
  /** Seconds until the window rolls over. */
  retryAfterSeconds: number
}

/**
 * INCR + EXPIRE NX for one bucket.
 *
 * The CASE arms are the fixed window: a row whose window has elapsed restarts at
 * 1 with a fresh window, and a row inside its window increments without
 * extending it. Redis achieved the same with `EXPIRE … NX` and an absent key;
 * here the row survives its window, so "expired" has to be said explicitly.
 */
export async function incrementRateBucket(spec: BucketIncrement): Promise<BucketState> {
  const result = await db.execute(sql`
    INSERT INTO rate_bucket (workspace_key, key, count, window_expires_at)
    VALUES (
      ${currentWorkspaceNamespace()},
      ${spec.key},
      1,
      now() + make_interval(secs => ${ttlSeconds(spec.windowSeconds)})
    )
    ON CONFLICT (workspace_key, key) DO UPDATE
      SET count = CASE WHEN rate_bucket.window_expires_at <= now() THEN 1 ELSE rate_bucket.count + 1 END,
          window_expires_at = CASE
            WHEN rate_bucket.window_expires_at <= now() THEN EXCLUDED.window_expires_at
            ELSE rate_bucket.window_expires_at
          END
    RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_expires_at - now()))))::int AS retry_after
  `)
  const rows = getExecuteRows<{ count: number; retry_after: number }>(result)
  const row = rows[0]
  return {
    count: Number(row?.count ?? 0),
    retryAfterSeconds: Number(row?.retry_after ?? spec.windowSeconds),
  }
}

/**
 * INCR + EXPIRE NX for many buckets, still one round trip.
 *
 * Duplicate keys are collapsed first: `ON CONFLICT DO UPDATE` refuses to affect
 * the same row twice in one statement (`ERROR: … cannot affect row a second
 * time`), and a caller checking, say, a per-principal and a per-IP bucket that
 * happen to name the same key would otherwise take the whole request down. The
 * collapsed key is incremented once and its count reported for every position
 * that asked for it — which is what a Redis pipeline of two INCRs on one key
 * would NOT do (it would count two). The difference is deliberate and
 * conservative: it can only under-count, never over-throttle.
 */
export async function incrementRateBuckets(
  specs: readonly BucketIncrement[]
): Promise<BucketState[]> {
  if (specs.length === 0) return []

  const byKey = new Map<string, number>()
  for (const spec of specs) {
    const existing = byKey.get(spec.key)
    // Shortest window wins, so a collapsed pair cannot be given a longer window
    // than the strictest caller asked for.
    if (existing === undefined || spec.windowSeconds < existing) {
      byKey.set(spec.key, ttlSeconds(spec.windowSeconds))
    }
  }
  const unique = [...byKey.entries()].map(([key, windowSeconds]) => ({ key, windowSeconds }))

  const result = await db.execute(sql`
    INSERT INTO rate_bucket (workspace_key, key, count, window_expires_at)
    SELECT
      ${currentWorkspaceNamespace()},
      spec->>'key',
      1,
      now() + make_interval(secs => (spec->>'windowSeconds')::numeric)
    FROM jsonb_array_elements(${JSON.stringify(unique)}::jsonb) AS spec
    ON CONFLICT (workspace_key, key) DO UPDATE
      SET count = CASE WHEN rate_bucket.window_expires_at <= now() THEN 1 ELSE rate_bucket.count + 1 END,
          window_expires_at = CASE
            WHEN rate_bucket.window_expires_at <= now() THEN EXCLUDED.window_expires_at
            ELSE rate_bucket.window_expires_at
          END
    RETURNING key, count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_expires_at - now()))))::int AS retry_after
  `)

  const rows = getExecuteRows<{ key: string; count: number; retry_after: number }>(result)
  const observed = new Map(rows.map((r) => [r.key, r]))
  return specs.map((spec) => {
    const row = observed.get(spec.key)
    return {
      count: Number(row?.count ?? 0),
      retryAfterSeconds: Number(row?.retry_after ?? spec.windowSeconds),
    }
  })
}

/** Live count for a window that has not expired. Missing or expired is 0. */
export async function rateBucketCount(key: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT count FROM rate_bucket
    WHERE workspace_key = ${currentWorkspaceNamespace()} AND key = ${key} AND window_expires_at > now()
  `)
  const rows = getExecuteRows<{ count: number }>(result)
  return Number(rows[0]?.count ?? 0)
}

/** TTL. Falls back to the window size when the bucket is absent or expired. */
export async function rateBucketRetryAfter(spec: BucketIncrement): Promise<number> {
  const result = await db.execute(sql`
    SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_expires_at - now()))))::int AS retry_after
    FROM rate_bucket
    WHERE workspace_key = ${currentWorkspaceNamespace()} AND key = ${spec.key} AND window_expires_at > now()
  `)
  const rows = getExecuteRows<{ retry_after: number }>(result)
  return rows.length > 0 ? Number(rows[0].retry_after) : spec.windowSeconds
}
