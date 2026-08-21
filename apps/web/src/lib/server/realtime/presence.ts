/**
 * Conversation presence, backed by the tenant's Postgres database so it works
 * across replicas.
 *
 * Used to gate offline notifications and offline re-queue: a principal is online
 * while any of their SSE streams is live. Each stream is a row scored by its
 * last heartbeat, so "online" and "last stream closed" are correct across
 * replicas (not just within one process) and self-heal if a replica dies without
 * cleanup — stale rows are excluded by predicate and pruned on the next write.
 *
 * ## What replaced the Lua script
 *
 * Redis held TWO keys: a per-principal sorted set of streams, and a shared
 * `conversation:presence:agents` set. The `EVAL` in the previous version existed
 * to keep them consistent — remove the stream, prune stale members, and drop the
 * principal from the agents set only if nothing remained, with no interleave.
 *
 * There is no second key here. `is_agent` is a column on the stream row, so
 * "which agents are online" is *derived* from the same rows rather than
 * maintained alongside them, and the drift the script prevented is
 * unrepresentable. What still needs atomicity is the decision "was that the last
 * live stream", and `clearPresence` below is a single statement — indivisible
 * for the same reason the Lua script was, and proven under concurrent writers in
 * `__tests__/presence-concurrency.db.test.ts`.
 *
 * ## Cost
 *
 * The migration's expected cost here was a write per live stream every 20s,
 * which Redis absorbed for free. It is now ONE statement per heartbeat where
 * Redis issued three commands (ZADD, EXPIRE, ZADD). The measurement is in
 * `lib/server/kv/KV.md`.
 *
 * ## Tenant isolation
 *
 * `listOnlineAgentIds()` feeds conversation routing, so a foreign principal id
 * in its result would assign a conversation to someone who cannot see it. That
 * cannot happen here for two independent reasons: under pooled tenancy the rows
 * live in the tenant's own database, and every statement below additionally
 * filters `tenant_id = currentTenantNamespace()` — the same value that formed
 * the Redis key prefix.
 */
import { sql } from 'drizzle-orm'
import { db, principal, eq, and, inArray } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { currentTenantNamespace } from '@/lib/server/tenancy/tenant-keyed'
import type { PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'presence' })

/** Must comfortably exceed the SSE heartbeat interval (20s). */
export const PRESENCE_TTL_SECONDS = 45

async function writePresent(
  principalId: PrincipalId,
  streamId: string,
  isAgent: boolean
): Promise<void> {
  // One statement for what Redis needed three commands to do. The DELETE arm is
  // the prune that `ZREMRANGEBYSCORE` used to perform on read: a principal's
  // abandoned streams are reclaimed by their own heartbeats, so a replica that
  // died mid-stream costs at most one stale row until its owner reconnects.
  await db.execute(sql`
    WITH pruned AS (
      DELETE FROM presence_stream
      WHERE tenant_id = ${currentTenantNamespace()}
        AND principal_id = ${principalId}
        AND stream_id <> ${streamId}
        AND heartbeat_at <= now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
    )
    INSERT INTO presence_stream (tenant_id, principal_id, stream_id, is_agent, heartbeat_at)
    VALUES (${currentTenantNamespace()}, ${principalId}, ${streamId}, ${isAgent}, now())
    ON CONFLICT (tenant_id, principal_id, stream_id) DO UPDATE
      SET heartbeat_at = now(), is_agent = EXCLUDED.is_agent
  `)
}

/** Register a new stream for a principal and mark them present. */
export async function markPresent(
  principalId: PrincipalId,
  streamId: string,
  isAgent: boolean
): Promise<void> {
  try {
    await writePresent(principalId, streamId, isAgent)
  } catch (err) {
    log.warn({ err, principal_id: principalId, stream_id: streamId }, 'mark present failed')
  }
}

/** Refresh a stream's presence on heartbeat. */
export async function refreshPresence(
  principalId: PrincipalId,
  streamId: string,
  isAgent: boolean
): Promise<void> {
  try {
    await writePresent(principalId, streamId, isAgent)
  } catch (err) {
    log.warn({ err, principal_id: principalId, stream_id: streamId }, 'refresh presence failed')
  }
}

/**
 * Deregister a stream. Returns true when it was the principal's last live stream
 * cluster-wide (they just went offline), so callers can react (e.g. re-queue an
 * agent's unanswered conversations). Stale rows from a crashed replica are
 * pruned first, so a ghost stream cannot keep the principal "online" past the
 * TTL. Returns false on error (don't report a clean offline we couldn't write).
 *
 * ## Why this is a transaction with a lock, and not one clever statement
 *
 * A single statement is atomic, and that is NOT sufficient here — which a
 * single-threaded test cannot tell you, and 24 concurrent teardowns can. The
 * first implementation of this function did the delete and the "is anyone left"
 * check as two CTEs of one statement. Every CTE in a statement shares one
 * snapshot, so with N streams closing at once **every** caller saw the other
 * N−1 rows still present and returned false: `wentOffline` was reported by
 * **zero** of 24, not one. An agent's unanswered conversations would never have
 * been re-queued, silently, and only under load.
 *
 * The fix is the thing Redis was giving away for free: serialization. A
 * transaction-scoped advisory lock keyed on (tenant, principal) makes the
 * concurrent teardowns queue, and because READ COMMITTED takes a **fresh
 * snapshot per statement**, the count that follows the lock sees the
 * predecessors' committed deletes. Exactly one caller finds nothing left.
 *
 * Transaction-scoped (`pg_advisory_xact_lock`) rather than session-scoped, and
 * that distinction is load-bearing on a pooled connection: a session-level
 * advisory lock through a transaction-mode pooler fails open non-deterministically
 * depending on which backend the pooler picks, and survives client disconnect.
 * An xact lock is held by a transaction, which the pooler pins to one backend
 * for its whole life, and is released by COMMIT whatever happens to the client.
 *
 * This is the disconnect path, not the heartbeat path — `writePresent` above is
 * still one statement and takes no lock. Serialization is paid once per stream
 * close, not 3 times a minute per stream.
 */
export async function clearPresence(
  principalId: PrincipalId,
  streamId: string,
  isAgent: boolean
): Promise<boolean> {
  // `isAgent` is no longer needed to decide anything — the agents set is derived
  // from `is_agent` on the rows themselves. Kept in the signature because the
  // callers pair it with markPresent/refreshPresence and dropping it there would
  // be a wider change than this piece owns.
  void isAgent
  const namespace = currentTenantNamespace()
  try {
    return await db.transaction(async (tx) => {
      // Keyed on tenant AND principal: two workspaces closing a stream for
      // coincidentally-equal principal ids must not serialize against each
      // other. A hash collision costs only extra queueing.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${namespace} || '|' || ${principalId})::bigint
        )
      `)
      await tx.execute(sql`
        DELETE FROM presence_stream
        WHERE tenant_id = ${namespace}
          AND principal_id = ${principalId}
          AND (
            stream_id = ${streamId}
            OR heartbeat_at <= now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
          )
      `)
      const result = await tx.execute(sql`
        SELECT NOT EXISTS (
          SELECT 1 FROM presence_stream
          WHERE tenant_id = ${namespace}
            AND principal_id = ${principalId}
            AND heartbeat_at > now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
        ) AS went_offline
      `)
      return getExecuteRows<{ went_offline: boolean }>(result)[0]?.went_offline === true
    })
  } catch (err) {
    log.warn({ err, principal_id: principalId, stream_id: streamId }, 'clear presence failed')
    return false
  }
}

/** Whether a specific principal currently has a live stream on any replica. */
export async function isPrincipalOnline(principalId: PrincipalId): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM presence_stream
        WHERE tenant_id = ${currentTenantNamespace()}
          AND principal_id = ${principalId}
          AND heartbeat_at > now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
      ) AS online
    `)
    return getExecuteRows<{ online: boolean }>(result)[0]?.online === true
  } catch (err) {
    log.warn({ err, principal_id: principalId }, 'principal online check failed')
    // Fail CLOSED (treat as offline) so an outage doesn't silently swallow
    // offline reply notifications — a possibly-redundant email beats a reply the
    // visitor never sees.
    return false
  }
}

/** Whether any team member currently has a live inbox stream. */
export async function isAnyAgentOnline(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM presence_stream
        WHERE tenant_id = ${currentTenantNamespace()}
          AND is_agent
          AND heartbeat_at > now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
      ) AS online
    `)
    return getExecuteRows<{ online: boolean }>(result)[0]?.online === true
  } catch (err) {
    log.warn({ err }, 'any agent online check failed')
    return true
  }
}

/**
 * Principal ids of all team members with a live inbox stream right now. Used by
 * conversation routing to pick an active agent. Fails CLOSED (returns []) so an
 * outage leaves new conversations unassigned rather than mis-routing them.
 */
export async function listOnlineAgentIds(): Promise<PrincipalId[]> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT principal_id FROM presence_stream
      WHERE tenant_id = ${currentTenantNamespace()}
        AND is_agent
        AND heartbeat_at > now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
    `)
    return getExecuteRows<{ principal_id: string }>(result).map(
      (r) => r.principal_id as PrincipalId
    )
  } catch (err) {
    log.warn({ err }, 'list online agents failed')
    return []
  }
}

/**
 * Of the given online principals, those NOT manually set to "away" — i.e. the
 * ones a conversation can actually be routed to. Fails CLOSED ([]) on a DB
 * error so we never route to an agent we can't confirm is available.
 */
export async function listAvailableAgentIds(onlineIds: PrincipalId[]): Promise<PrincipalId[]> {
  if (onlineIds.length === 0) return []
  try {
    const rows = await db
      .select({ id: principal.id })
      .from(principal)
      .where(and(inArray(principal.id, onlineIds), eq(principal.chatAvailability, 'online')))
    return rows.map((r) => r.id)
  } catch (err) {
    log.warn({ err }, 'list available agents failed')
    return []
  }
}

/**
 * Whether any team member is online AND available (not "away"). Drives the
 * widget's availability — a team that's connected but all-away reads as offline.
 */
export async function isAnyAgentAvailable(): Promise<boolean> {
  const onlineIds = await listOnlineAgentIds()
  if (onlineIds.length === 0) return false
  return (await listAvailableAgentIds(onlineIds)).length > 0
}

/** Set an agent's manual availability ('online' | 'away'); persisted on the principal. */
export async function setAgentAvailability(
  principalId: PrincipalId,
  availability: 'online' | 'away'
): Promise<void> {
  await db
    .update(principal)
    .set({ chatAvailability: availability })
    .where(eq(principal.id, principalId))
}
