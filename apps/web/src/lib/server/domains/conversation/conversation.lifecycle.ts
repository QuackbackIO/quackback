import type { PrincipalId } from '@quackback/ids'
import type { ConversationStatus, ConversationEndReason } from '@/lib/shared/conversation/types'

/**
 * Conversation status transitions, kept pure so they're unit-tested directly.
 *
 * The lifecycle: open (active) | snoozed (deferred, waking on a timer or the
 * customer's next reply) | closed (resolved).
 */

/**
 * A visitor message always surfaces the conversation — it returns to 'open'
 * from any prior state: a reply wakes a 'snoozed' thread and reopens a
 * 'closed' one. ONE exception (SF3, Phase C conversational block layer): a
 * MATCHED structured reply (a CSAT rating, a button tap, ...) answering a
 * block a workflow posted on an ALREADY-closed conversation is the intended
 * flow — a post-close CSAT survey or a post-close button prompt, not the
 * customer reopening the thread — so it leaves 'closed' as-is instead.
 * `hasMatchedBlockReply` must be the send-time resolution result
 * (`resolvedBlockReply !== null` in conversation.service.ts — i.e. the reply
 * genuinely echoes a real, same-conversation, agent-authored, unanswered
 * block), never the raw client-supplied blockReply payload: an unmatched/
 * stale/forged one degrades to an ordinary free-text send and still reopens,
 * same as before this exception existed.
 */
export function applyVisitorReopenStatus(
  priorStatus: ConversationStatus,
  hasMatchedBlockReply: boolean
): ConversationStatus {
  if (priorStatus === 'closed' && hasMatchedBlockReply) return 'closed'
  return 'open'
}

/**
 * An agent reply reopens a 'closed' thread, but preserves 'snoozed' — ANY
 * teammate replying into a snoozed thread is "send and stay snoozed" (a
 * deliberate reply does not re-queue it), leaving the snooze timer or an
 * explicit reopen to bring it back.
 */
export function applyAgentReopenStatus(current: ConversationStatus): ConversationStatus {
  return current === 'closed' ? 'open' : current
}

/**
 * Whether a triage/attribute update should WAKE a snoozed conversation. A
 * non-assignee teammate touching a snoozed thread (priority, reassignment, …)
 * pulls it back into the open queue; the assignee's own edits leave it snoozed
 * (send-and-stay-snoozed). Only applies while snoozed.
 */
export function shouldWakeSnoozedOnTriage(
  status: ConversationStatus,
  actorPrincipalId: PrincipalId | null,
  assignedAgentPrincipalId: PrincipalId | null
): boolean {
  if (status !== 'snoozed') return false
  return actorPrincipalId !== assignedAgentPrincipalId
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
