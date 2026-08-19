/**
 * Ephemeral snapshot of Quinn's live activity trace, backed by Redis.
 *
 * The widget's working trace ("Thinking...", "Searching the knowledge
 * base...") is published as a fire-and-forget event on the conversation
 * channel, which only reaches subscribers already connected at publish time.
 * A brand-new conversation's stream connects AFTER the turn starts, so the
 * first "thinking" event is lost and the visible trace starts mid-turn (or
 * not at all, for a short answer). Treating the trace as state fixes this: the
 * latest activity is mirrored into Redis on every publish, and a subscriber
 * that connects mid-turn reads it once, right after subscribing, to replay
 * the current state as its first frame.
 *
 * Best-effort throughout, via the shared cache helpers: a Redis failure must
 * never fail the turn or the stream.
 */
import { cacheGet, cacheSet, cacheDel } from '@/lib/server/redis'
import type { ConversationId } from '@quackback/ids'

/** Comfortably longer than the gap between activity publishes in a live turn;
 *  refreshed on every write, so this only bounds how long a crashed turn's
 *  last-known state lingers. */
export const ASSISTANT_ACTIVITY_SNAPSHOT_TTL_SECONDS = 30

function activitySnapshotKey(conversationId: ConversationId): string {
  return `assistant:activity:${conversationId}`
}

/** Write (or refresh) the latest activity event for a conversation's
 *  in-flight turn. `event` is the exact payload published on the conversation
 *  channel, so a replayed snapshot is indistinguishable from a live frame to
 *  the client. */
export async function writeActivitySnapshot(
  conversationId: ConversationId,
  event: unknown
): Promise<void> {
  await cacheSet(
    activitySnapshotKey(conversationId),
    event,
    ASSISTANT_ACTIVITY_SNAPSHOT_TTL_SECONDS
  )
}

/**
 * Clear the snapshot once the turn is no longer in flight: the reply landed,
 * the engine suppressed the turn, or it handed off. Called on every exit path
 * so a subscriber that connects after the turn finished never replays a
 * stale "Thinking..." over a conversation that already has its answer.
 */
export async function clearActivitySnapshot(conversationId: ConversationId): Promise<void> {
  await cacheDel(activitySnapshotKey(conversationId))
}

/** Read the latest activity snapshot for a conversation, if a turn is in
 *  flight. Null on a miss (no turn running) or a Redis error. */
export async function readActivitySnapshot(conversationId: ConversationId): Promise<unknown> {
  return cacheGet<unknown>(activitySnapshotKey(conversationId))
}
