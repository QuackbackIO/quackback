import type { ConversationStatus, ConversationEndReason } from '@/lib/shared/chat/types'

/**
 * Conversation status transitions, kept pure so they're unit-tested directly.
 *
 * A "content surface" lifecycle: open (active) | pending (waiting on the
 * customer) | closed (resolved).
 */

/**
 * A visitor message always surfaces the conversation — it returns to 'open'
 * from any prior state: a reply answers a 'pending' thread and reopens a
 * 'closed' one. (No parameter: the result never depends on the prior status.)
 */
export function applyVisitorReopenStatus(): ConversationStatus {
  return 'open'
}

/**
 * An agent reply reopens a 'closed' thread, but preserves 'pending' (still
 * waiting on the customer — replying again doesn't change that).
 */
export function applyAgentReopenStatus(current: ConversationStatus): ConversationStatus {
  return current === 'closed' ? 'open' : current
}

/** resolvedAt is stamped when a conversation is closed/resolved, cleared otherwise. */
export function resolvedAtForStatus(status: ConversationStatus, now: Date): Date | null {
  return status === 'closed' ? now : null
}

/**
 * When an assigned agent goes offline, return their unanswered conversations to
 * the queue so they aren't stranded — but only open threads the agent never
 * replied to. An engaged thread (an agent reply exists) stays theirs; closed
 * and pending threads are left alone.
 */
export function shouldRequeueOnAgentOffline(
  status: ConversationStatus,
  hasAgentReply: boolean
): boolean {
  return status === 'open' && !hasAgentReply
}

/**
 * The new agent read-watermark for "mark unread from this message". The anchor
 * and everything after it must count as unread, so the watermark moves to just
 * before the anchor — but only ever BACKWARD. Marking an already-unread message
 * unread is a no-op, and we never advance the watermark (which would silently
 * re-mark earlier unread messages as read). A never-read conversation (null
 * watermark) is already fully unread, so it stays null.
 */
export function unreadWatermarkFromAnchor(
  currentAgentLastReadAt: Date | null,
  anchorCreatedAt: Date
): Date | null {
  if (currentAgentLastReadAt === null) return null
  const candidate = new Date(anchorCreatedAt.getTime() - 1)
  return candidate < currentAgentLastReadAt ? candidate : currentAgentLastReadAt
}

/** End reasons that count as a real resolution for the resolved-rate numerator. */
const RESOLVED_END_REASONS: ReadonlySet<ConversationEndReason> = new Set([
  'resolved',
  'tracked_as_feedback',
])

/**
 * Resolved-rate over a batch of ended conversations: the fraction that reached a
 * real resolution. 'resolved' and 'tracked_as_feedback' both count as resolved;
 * 'spam' is dropped from the denominator entirely (it never represented a real
 * request). An ended conversation with no recorded reason (null) still counts in
 * the denominator — it was ended, just not resolved. Pure so the future
 * analytics surface can compute the rate from counts without a DB round-trip;
 * returns 0 for an empty denominator.
 */
export function resolvedConversationRate(
  endReasons: ReadonlyArray<ConversationEndReason | null>
): number {
  let resolved = 0
  let denominator = 0
  for (const reason of endReasons) {
    if (reason === 'spam') continue
    denominator += 1
    if (reason && RESOLVED_END_REASONS.has(reason)) resolved += 1
  }
  return denominator === 0 ? 0 : resolved / denominator
}
