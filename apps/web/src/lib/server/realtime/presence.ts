/**
 * Live chat presence, backed by Redis so it works across replicas.
 *
 * Used to gate offline notifications and offline re-queue: a principal is online
 * while any of their SSE streams is live. Each stream is a member of a
 * per-principal sorted set scored by its last heartbeat, so "online" and "last
 * stream closed" are correct across replicas (not just within one process) and
 * self-heal if a replica dies without cleanup — Redis drops an empty sorted set
 * automatically, stale members are pruned by score, and a TTL backstop reclaims
 * an abandoned set.
 */
import { getRedis } from '../redis'
import { db, principal, eq, and, inArray } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'presence' })

/** TTL must comfortably exceed the SSE heartbeat interval (20s). */
export const PRESENCE_TTL_SECONDS = 45

const AGENTS_ZSET = 'chat:presence:agents'

/** Per-principal set of live stream ids, each scored by its last-heartbeat ms. */
function streamsKey(principalId: PrincipalId): string {
  return `chat:presence:streams:${principalId}`
}

/** Members older than this haven't heartbeat within the TTL → treat as gone. */
function staleCutoff(): number {
  return Date.now() - PRESENCE_TTL_SECONDS * 1000
}

// Atomic last-stream teardown: remove this stream, prune stale members, and —
// only if no live stream remains — drop the principal from the agents set,
// returning 1 when they just went offline. Atomic so a concurrent reconnect
// (markPresent on another tab/replica) landing between the count and the
// agents-removal can't wrongly mark a still-online agent offline.
// KEYS: [1]=streams set, [2]=agents set. ARGV: [1]=streamId, [2]=staleCutoff,
// [3]=principalId, [4]=isAgent ('1'|'0').
const CLEAR_PRESENCE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[2])
if tonumber(redis.call('ZCARD', KEYS[1])) > 0 then
  return 0
end
if ARGV[4] == '1' then
  redis.call('ZREM', KEYS[2], ARGV[3])
end
return 1
`

async function writePresent(
  principalId: PrincipalId,
  streamId: string,
  isAgent: boolean
): Promise<void> {
  const redis = getRedis()
  const now = Date.now()
  await redis.zadd(streamsKey(principalId), now, streamId)
  // Backstop so an abandoned set (a replica that died mid-stream) is reclaimed
  // even if no one reads it again; refreshed on every heartbeat.
  await redis.expire(streamsKey(principalId), PRESENCE_TTL_SECONDS)
  if (isAgent) await redis.zadd(AGENTS_ZSET, now, principalId)
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
 * agent's unanswered chats). Stale members from a crashed replica are pruned
 * first, so a ghost stream can't keep the principal "online" beyond the TTL.
 * Returns false on a Redis error (don't report a clean offline we couldn't write).
 */
export async function clearPresence(
  principalId: PrincipalId,
  streamId: string,
  isAgent: boolean
): Promise<boolean> {
  try {
    const wentOffline = await getRedis().eval(
      CLEAR_PRESENCE_SCRIPT,
      2,
      streamsKey(principalId),
      AGENTS_ZSET,
      streamId,
      String(staleCutoff()),
      principalId,
      isAgent ? '1' : '0'
    )
    return Number(wentOffline) === 1
  } catch (err) {
    log.warn({ err, principal_id: principalId, stream_id: streamId }, 'clear presence failed')
    return false
  }
}

/** Whether a specific principal currently has a live stream on any replica. */
export async function isPrincipalOnline(principalId: PrincipalId): Promise<boolean> {
  try {
    const redis = getRedis()
    const key = streamsKey(principalId)
    await redis.zremrangebyscore(key, 0, staleCutoff())
    return (await redis.zcard(key)) > 0
  } catch (err) {
    log.warn({ err, principal_id: principalId }, 'principal online check failed')
    // Fail CLOSED (treat as offline) so a Redis outage doesn't silently swallow
    // offline reply notifications — a possibly-redundant email beats a reply the
    // visitor never sees.
    return false
  }
}

/** Whether any team member currently has a live inbox stream. */
export async function isAnyAgentOnline(): Promise<boolean> {
  try {
    const redis = getRedis()
    await redis.zremrangebyscore(AGENTS_ZSET, 0, staleCutoff())
    const count = await redis.zcard(AGENTS_ZSET)
    return count > 0
  } catch (err) {
    log.warn({ err }, 'any agent online check failed')
    return true
  }
}

/**
 * Principal ids of all team members with a live inbox stream right now (stale
 * entries pruned first). Used by conversation routing to pick an active agent.
 * Fails CLOSED (returns []) so a Redis outage leaves new conversations
 * unassigned rather than mis-routing them.
 */
export async function listOnlineAgentIds(): Promise<PrincipalId[]> {
  try {
    const redis = getRedis()
    await redis.zremrangebyscore(AGENTS_ZSET, 0, staleCutoff())
    const ids = await redis.zrange(AGENTS_ZSET, 0, -1)
    return ids as PrincipalId[]
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
