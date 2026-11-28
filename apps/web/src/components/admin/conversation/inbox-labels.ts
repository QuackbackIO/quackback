import type { MessageDescriptor } from 'react-intl'
import type {
  ConversationEndReason,
  ConversationPriority,
  ConversationSpamFiledBy,
} from '@/lib/shared/conversation/types'
import type { ConversationSort } from '@/lib/shared/conversation/views'
import type { SlaTargetKind } from '@/lib/shared/conversation/sla'
import { isNativeIssueChannel, type Channel } from '@/lib/shared/channels'

type Descriptor = MessageDescriptor & { defaultMessage: string }

/**
 * The inbox's words for values the shared conversation modules name in
 * English (priorities, end and spam reasons, sorts, SLA targets). The shared
 * tables keep their English for server code and logs; the inbox words them by
 * value here.
 */
export const PRIORITY_LABELS: Record<ConversationPriority, Descriptor> = {
  none: { id: 'admin.inbox.labels.priority.none', defaultMessage: 'None' },
  low: { id: 'admin.inbox.labels.priority.low', defaultMessage: 'Low' },
  medium: { id: 'admin.inbox.labels.priority.medium', defaultMessage: 'Medium' },
  high: { id: 'admin.inbox.labels.priority.high', defaultMessage: 'High' },
  urgent: { id: 'admin.inbox.labels.priority.urgent', defaultMessage: 'Urgent' },
}

/** The priority control's own name, shown while no priority is set. */
export const PRIORITY_PLACEHOLDER: Descriptor = {
  id: 'admin.inbox.labels.priority.placeholder',
  defaultMessage: 'Priority',
}

export const END_REASON_LABELS: Record<ConversationEndReason, Descriptor> = {
  resolved: { id: 'admin.inbox.labels.endReason.resolved', defaultMessage: 'Resolved' },
  tracked_as_feedback: {
    id: 'admin.inbox.labels.endReason.trackedAsFeedback',
    defaultMessage: 'Tracked as feedback',
  },
  duplicate: {
    id: 'admin.inbox.labels.endReason.duplicate',
    defaultMessage: 'Duplicate / already handled',
  },
  no_response: {
    id: 'admin.inbox.labels.endReason.noResponse',
    defaultMessage: 'No response from customer',
  },
  spam: { id: 'admin.inbox.labels.endReason.spam', defaultMessage: 'Spam / not actionable' },
  other: { id: 'admin.inbox.labels.endReason.other', defaultMessage: 'Other' },
}

export const SPAM_REASON_LABELS: Record<ConversationSpamFiledBy, Descriptor> = {
  auto_responder: { id: 'admin.inbox.labels.spam.autoResponder', defaultMessage: 'Auto-responder' },
  sender_auth_failure: {
    id: 'admin.inbox.labels.spam.senderAuthFailure',
    defaultMessage: 'Sender-auth failure',
  },
  sender_auth_reject: {
    id: 'admin.inbox.labels.spam.senderAuthReject',
    defaultMessage: 'Sender-auth refused',
  },
  sender_auth_arc_rescued: {
    id: 'admin.inbox.labels.spam.senderAuthArcRescued',
    defaultMessage: 'Forwarder-vouched, unverified',
  },
  mail_loop_suspected: {
    id: 'admin.inbox.labels.spam.mailLoopSuspected',
    defaultMessage: 'Suspected mail loop',
  },
  burst_rate: { id: 'admin.inbox.labels.spam.burstRate', defaultMessage: 'Burst rate' },
  ai_classifier: { id: 'admin.inbox.labels.spam.aiClassifier', defaultMessage: 'AI classifier' },
  manual: { id: 'admin.inbox.labels.spam.manual', defaultMessage: 'Manually filed' },
}

export const SORT_LABELS: Record<ConversationSort, Descriptor> = {
  relevance: { id: 'admin.inbox.labels.sort.relevance', defaultMessage: 'Best match' },
  recent: { id: 'admin.inbox.labels.sort.recent', defaultMessage: 'Most recent' },
  oldest: { id: 'admin.inbox.labels.sort.oldest', defaultMessage: 'Oldest' },
  created: { id: 'admin.inbox.labels.sort.created', defaultMessage: 'Recently created' },
  waiting: { id: 'admin.inbox.labels.sort.waiting', defaultMessage: 'Waiting longest' },
  priority: { id: 'admin.inbox.labels.sort.priority', defaultMessage: 'Priority' },
  sla: { id: 'admin.inbox.labels.sort.sla', defaultMessage: 'SLA breach soonest' },
}

export const SLA_TARGET_LABELS: Record<SlaTargetKind, Descriptor> = {
  first_response: { id: 'admin.inbox.labels.sla.firstResponse', defaultMessage: 'first response' },
  next_response: { id: 'admin.inbox.labels.sla.nextResponse', defaultMessage: 'next response' },
  close: { id: 'admin.inbox.labels.sla.close', defaultMessage: 'time to close' },
}

/** The SLA chip's words around its countdown. */
export const SLA_CHIP = {
  paused: { id: 'admin.inbox.labels.sla.paused', defaultMessage: 'paused' },
  over: { id: 'admin.inbox.labels.sla.over', defaultMessage: '{time} over' },
} as const satisfies Record<string, Descriptor>

/** A conversation's status as the inbox shows it (the triage facet "waiting" too). */
export const STATUS_LABELS: Record<'open' | 'snoozed' | 'closed' | 'waiting', Descriptor> = {
  open: { id: 'admin.inbox.labels.status.open', defaultMessage: 'open' },
  snoozed: { id: 'admin.inbox.labels.status.snoozed', defaultMessage: 'snoozed' },
  closed: { id: 'admin.inbox.labels.status.closed', defaultMessage: 'closed' },
  waiting: { id: 'admin.inbox.labels.status.waiting', defaultMessage: 'waiting' },
}

export const STATUS_WORDS = {
  status: { id: 'admin.inbox.labels.status.placeholder', defaultMessage: 'Status' },
  spam: { id: 'admin.inbox.labels.status.spam', defaultMessage: 'Spam' },
  snoozedUntil: {
    id: 'admin.inbox.labels.status.snoozedUntil',
    defaultMessage: 'Snoozed until {date}',
  },
  sortBy: { id: 'admin.inbox.labels.sort.prefix', defaultMessage: 'Sort: {label}' },
} as const satisfies Record<string, Descriptor>

/** The assignee control's words when no name is shown. */
export const ASSIGNEE_WORDS = {
  assigned: { id: 'admin.inbox.labels.assignee.assigned', defaultMessage: 'Assigned' },
  unassigned: { id: 'admin.inbox.labels.assignee.unassigned', defaultMessage: 'Unassigned' },
} as const satisfies Record<string, Descriptor>

/** The composer's own words. */
export const COMPOSER_WORDS = {
  reply: { id: 'admin.inbox.labels.composer.reply', defaultMessage: 'Reply' },
  replyAll: { id: 'admin.inbox.labels.composer.replyAll', defaultMessage: 'Reply all' },
  note: { id: 'admin.inbox.labels.composer.note', defaultMessage: 'Note' },
  improve: { id: 'admin.inbox.labels.composer.improve', defaultMessage: 'Improve' },
  improving: { id: 'admin.inbox.labels.composer.improving', defaultMessage: 'Improving…' },
  placeholderReply: {
    id: 'admin.inbox.labels.composer.placeholderReply',
    defaultMessage: 'Type your reply…',
  },
  placeholderTicket: {
    id: 'admin.inbox.labels.composer.placeholderTicket',
    defaultMessage: 'Reply to the requester…',
  },
  placeholderClosedIssue: {
    id: 'admin.inbox.labels.composer.placeholderClosedIssue',
    defaultMessage: 'Comment on the closed issue…',
  },
} as const satisfies Record<string, Descriptor>

/**
 * Closing words, which name an issue on channels whose conversations are
 * tracker issues (the shared helpers in lib/shared/channels/close.ts keep the
 * English for the server).
 */
export const CLOSE_WORDS = {
  close: { id: 'admin.inbox.labels.close.close', defaultMessage: 'Close' },
  reopen: { id: 'admin.inbox.labels.close.reopen', defaultMessage: 'Reopen' },
  closeIssue: { id: 'admin.inbox.labels.close.closeIssue', defaultMessage: 'Close issue' },
  reopenIssue: { id: 'admin.inbox.labels.close.reopenIssue', defaultMessage: 'Reopen issue' },
  closed: { id: 'admin.inbox.labels.close.closed', defaultMessage: 'Conversation closed' },
  reopened: { id: 'admin.inbox.labels.close.reopened', defaultMessage: 'Conversation reopened' },
  issueClosed: { id: 'admin.inbox.labels.close.issueClosed', defaultMessage: 'Issue closed' },
  issueReopened: { id: 'admin.inbox.labels.close.issueReopened', defaultMessage: 'Issue reopened' },
  closeFailed: {
    id: 'admin.inbox.labels.close.closeFailed',
    defaultMessage: 'Failed to close conversation',
  },
  reopenFailed: {
    id: 'admin.inbox.labels.close.reopenFailed',
    defaultMessage: 'Failed to reopen conversation',
  },
  issueCloseFailed: {
    id: 'admin.inbox.labels.close.issueCloseFailed',
    defaultMessage: 'Failed to close issue',
  },
  issueReopenFailed: {
    id: 'admin.inbox.labels.close.issueReopenFailed',
    defaultMessage: 'Failed to reopen issue',
  },
} as const satisfies Record<string, Descriptor>

/** The inbox scope names the list header shows for a built-in view. */
export const SCOPE_LABELS = {
  all: { id: 'admin.inbox.labels.scope.all', defaultMessage: 'All conversations' },
  mine: { id: 'admin.inbox.labels.scope.mine', defaultMessage: 'Assigned to me' },
  unassigned: { id: 'admin.inbox.labels.scope.unassigned', defaultMessage: 'Unassigned' },
  saved: { id: 'admin.inbox.labels.scope.saved', defaultMessage: 'Saved messages' },
  ticketsAll: { id: 'admin.inbox.labels.scope.ticketsAll', defaultMessage: 'All tickets' },
  ticketsCustomer: {
    id: 'admin.inbox.labels.scope.ticketsCustomer',
    defaultMessage: 'Customer tickets',
  },
  ticketsBackOffice: {
    id: 'admin.inbox.labels.scope.ticketsBackOffice',
    defaultMessage: 'Back office tickets',
  },
  ticketsTracker: { id: 'admin.inbox.labels.scope.ticketsTracker', defaultMessage: 'Trackers' },
  mentions: { id: 'admin.inbox.inboxNavSidebar.mentions', defaultMessage: 'Mentions' },
  createdByMe: { id: 'admin.inbox.inboxNavSidebar.createdByMe', defaultMessage: 'Created by me' },
  spam: { id: 'admin.inbox.labels.status.spam', defaultMessage: 'Spam' },
  test: { id: 'inbox.view.test', defaultMessage: 'Test conversations' },
  quinn: { id: 'admin.inbox.inboxNavSidebar.aiAgentActivity', defaultMessage: 'AI agent activity' },
  tag: { id: 'admin.inbox.labels.scope.tag', defaultMessage: 'Label' },
  segment: { id: 'admin.inbox.labels.scope.segment', defaultMessage: 'Segment' },
  team: { id: 'admin.inbox.labels.scope.team', defaultMessage: 'Team' },
  view: { id: 'admin.inbox.labels.scope.view', defaultMessage: 'View' },
} as const satisfies Record<string, Descriptor>

type ChannelRef = Channel | null | undefined

/** The close button's words for a conversation on a channel. */
export function closeActionWords(channel: ChannelRef, closed: boolean): Descriptor {
  if (isNativeIssueChannel(channel))
    return closed ? CLOSE_WORDS.reopenIssue : CLOSE_WORDS.closeIssue
  return closed ? CLOSE_WORDS.reopen : CLOSE_WORDS.close
}

/** The notice after closing (`closed`) or reopening. */
export function closeToastWords(channel: ChannelRef, closed: boolean): Descriptor {
  if (isNativeIssueChannel(channel))
    return closed ? CLOSE_WORDS.issueClosed : CLOSE_WORDS.issueReopened
  return closed ? CLOSE_WORDS.closed : CLOSE_WORDS.reopened
}

/** The notice when closing (`closed`) or reopening failed. */
export function closeFailureWords(channel: ChannelRef, closed: boolean): Descriptor {
  if (isNativeIssueChannel(channel)) {
    return closed ? CLOSE_WORDS.issueCloseFailed : CLOSE_WORDS.issueReopenFailed
  }
  return closed ? CLOSE_WORDS.closeFailed : CLOSE_WORDS.reopenFailed
}

/** The reply composer's placeholder. */
export function replyPlaceholderWords(
  channel: ChannelRef,
  opts: { closed: boolean; isTicket: boolean }
): Descriptor {
  if (opts.isTicket) return COMPOSER_WORDS.placeholderTicket
  if (opts.closed && isNativeIssueChannel(channel)) return COMPOSER_WORDS.placeholderClosedIssue
  return COMPOSER_WORDS.placeholderReply
}
