import type { ConversationStatus } from '@/lib/shared/chat/types'

/**
 * Conversation status transitions, kept pure so they're unit-tested directly.
 *
 * A "content surface" lifecycle: open (active) | pending (waiting on the
 * customer) | snoozed (deferred by an agent) | closed (resolved).
 */

/**
 * A visitor message always surfaces the conversation — it returns to 'open'
 * from any prior state: a reply answers a 'pending' thread, un-defers a
 * 'snoozed' one, and reopens a 'closed' one. (No parameter: the result never
 * depends on the prior status.)
 */
export function applyVisitorReopenStatus(): ConversationStatus {
  return 'open'
}

/**
 * An agent reply reopens a 'closed' thread, but preserves 'pending' (still
 * waiting on the customer — replying again doesn't change that) and 'snoozed'
 * (the deferral stands until its timer or an explicit status change).
 */
export function applyAgentReopenStatus(current: ConversationStatus): ConversationStatus {
  return current === 'closed' ? 'open' : current
}

/** resolvedAt is stamped when a conversation is closed/resolved, cleared otherwise. */
export function resolvedAtForStatus(status: ConversationStatus, now: Date): Date | null {
  return status === 'closed' ? now : null
}
