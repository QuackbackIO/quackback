/**
 * Live chat presence, backed by Redis so it works across replicas.
 *
 * Used to gate offline notifications: email an agent only when no agent has a
 * live stream; email a visitor only when their stream is closed. Each open SSE
 * stream marks its principal present with a short TTL and refreshes it on every
 * heartbeat; the key expires on its own if a connection dies without cleanup.
 */
import { getRedis } from '../redis'
import type { PrincipalId } from '@quackback/ids'

/** TTL must comfortably exceed the SSE heartbeat interval (20s). */
export const PRESENCE_TTL_SECONDS = 45

const AGENTS_ZSET = 'chat:presence:agents'

// Per-process connection refcount per principal. A principal can hold several
// concurrent streams (multiple tabs, widget + portal); without a refcount, one
// stream's teardown would clear presence while another is still live. Redis
// holds the actual presence (cross-replica); this just decides WHEN to write.
const localStreamCounts = new Map<PrincipalId, number>()

function presenceKey(principalId: PrincipalId): string {
  return `chat:presence:p:${principalId}`
}

async function writePresent(principalId: PrincipalId, isAgent: boolean): Promise<void> {
  const redis = getRedis()
  await redis.set(presenceKey(principalId), '1', 'EX', PRESENCE_TTL_SECONDS)
  if (isAgent) await redis.zadd(AGENTS_ZSET, Date.now(), principalId)
}

/** Register a new stream for a principal and mark them present. */
export async function markPresent(principalId: PrincipalId, isAgent: boolean): Promise<void> {
  localStreamCounts.set(principalId, (localStreamCounts.get(principalId) ?? 0) + 1)
  try {
    await writePresent(principalId, isAgent)
  } catch (err) {
    console.warn('[presence] markPresent failed:', (err as Error).message)
  }
}

/** Refresh presence TTL on heartbeat (does not touch the refcount). */
export async function refreshPresence(principalId: PrincipalId, isAgent: boolean): Promise<void> {
  try {
    await writePresent(principalId, isAgent)
  } catch (err) {
    console.warn('[presence] refreshPresence failed:', (err as Error).message)
  }
}

/** Deregister a stream; only clear Redis presence once the last one closes. */
export async function clearPresence(principalId: PrincipalId, isAgent: boolean): Promise<void> {
  const next = (localStreamCounts.get(principalId) ?? 1) - 1
  if (next > 0) {
    localStreamCounts.set(principalId, next)
    return
  }
  localStreamCounts.delete(principalId)
  try {
    const redis = getRedis()
    await redis.del(presenceKey(principalId))
    if (isAgent) await redis.zrem(AGENTS_ZSET, principalId)
  } catch (err) {
    console.warn('[presence] clearPresence failed:', (err as Error).message)
  }
}

/** Whether a specific principal currently has a live stream. */
export async function isPrincipalOnline(principalId: PrincipalId): Promise<boolean> {
  try {
    const value = await getRedis().get(presenceKey(principalId))
    return value !== null
  } catch (err) {
    console.warn('[presence] isPrincipalOnline failed:', (err as Error).message)
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
    const cutoff = Date.now() - PRESENCE_TTL_SECONDS * 1000
    await redis.zremrangebyscore(AGENTS_ZSET, 0, cutoff)
    const count = await redis.zcard(AGENTS_ZSET)
    return count > 0
  } catch (err) {
    console.warn('[presence] isAnyAgentOnline failed:', (err as Error).message)
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
    const cutoff = Date.now() - PRESENCE_TTL_SECONDS * 1000
    await redis.zremrangebyscore(AGENTS_ZSET, 0, cutoff)
    const ids = await redis.zrange(AGENTS_ZSET, 0, -1)
    return ids as PrincipalId[]
  } catch (err) {
    console.warn('[presence] listOnlineAgentIds failed:', (err as Error).message)
    return []
  }
}
