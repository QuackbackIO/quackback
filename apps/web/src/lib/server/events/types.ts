/**
 * Event system types.
 */
import type { ConversationStatus } from '@/lib/shared/db-types'
import type { JsonValue } from '@/lib/shared/json'
import type { ConversationAttributeSource } from '@/lib/shared/conversation/attribute-values'
import type { Channel } from '@/lib/shared/channels'

/**
 * Timer-driven workflow triggers (support platform §4.6): synthetic events
 * emitted by workflow-sweep.ts's 5-minute tick (the unresponsive pair) or the
 * SLA domain's deadline scan (the SLA pair) — never raised by a real
 * user/system action. See lib/server/domains/workflows/dispatcher.ts's
 * dispatchWorkflowTrigger `targetWorkflowId` for why the unresponsive pair
 * dispatches differently from every other event type.
 *
 * These four alone are dispatched with a caller-supplied DETERMINISTIC id
 * (dispatch.ts `timerEventEnvelope`), so the outbox bridge keys their dedupe on
 * that id — see outbox-dispatch.ts. Kept as one exported constant so the two
 * lists can't drift (adding a timer event here also makes it deduped there).
 */
export const TIMER_DRIVEN_EVENT_TYPES = [
  'conversation.customer_unresponsive',
  'conversation.teammate_unresponsive',
  'sla.approaching_breach',
  'sla.breached',
  // The ticket-due sweep (domains/tickets/ticket-due.sweep.ts): one id per
  // ticket per due date, so a repeat tick for the same date dedupes.
  'ticket.due_soon',
  'ticket.overdue',
] as const

/**
 * Supported event types — single source of truth.
 * All UI components, webhook validators, and integration configs should reference this.
 */
export const EVENT_TYPES = [
  'post.created',
  'post.status_changed',
  'post.updated',
  'post.deleted',
  'post.restored',
  'post.merged',
  'post.unmerged',
  'post.mentioned',
  'post.owner_assigned',
  'post.voted',
  // Someone started or stopped following a post by hand (their own bell, or a
  // teammate adding or removing them). Automatic subscriptions (author, vote,
  // comment, owner) are side effects of other events and announce nothing.
  'post.subscriber_added',
  'post.subscriber_removed',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'changelog.published',
  'status.incident_created',
  'status.incident_updated',
  'status.maintenance_scheduled',
  'status.maintenance_started',
  'status.maintenance_completed',
  'status.component_changed',
  'conversation.created',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.priority_changed',
  'conversation.attribute_changed',
  'conversation.csat_submitted',
  'conversation.csat_comment_added',
  // Notification-only (WO-3 slice 3): an internal note @-mentions a teammate.
  // Never a workflow trigger — see lib/shared/workflow-trigger-types.ts's own
  // doc for why this event is deliberately absent from
  // DISPATCHABLE_TRIGGER_TYPES.
  'conversation.note_mentioned',
  'message.created',
  'message.note_created',
  'message.deleted',
  'message.updated',
  'ticket.created',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.replied',
  'ticket.note_added',
  // Notification-only: a linked tracker issue changed status upstream (fired by
  // the inbound integration webhook path, independent of any status mapping).
  'ticket.external_status_changed',
  // A teammate, workflow or integration set, moved or cleared the due date.
  'ticket.due_changed',
  // Someone started or stopped watching a ticket by hand (their own watch
  // toggle, or a teammate adding or removing them). Automatic watches
  // (requester, assignee, replier) are side effects of other events and
  // announce nothing.
  'ticket.subscriber_added',
  'ticket.subscriber_removed',
  // A teammate, the API or an integration renamed the ticket.
  'ticket.updated',
  'ticket.priority_changed',
  // A public reply on the ticket thread was edited or deleted.
  'ticket.reply_updated',
  'ticket.reply_deleted',
  // A file was added to or removed from a public ticket reply already sent.
  'ticket.attachment_added',
  'ticket.attachment_removed',
  'assistant.handed_off',
  'assistant.resolved',
  // Timer-driven triggers (see TIMER_DRIVEN_EVENT_TYPES above for the rationale).
  ...TIMER_DRIVEN_EVENT_TYPES,
  // Approvals: emitted natively by the pending-actions service. Webhook and
  // notification surfaces only, never workflow triggers.
  'approval.requested',
  'approval.decided',
  'approval.applied',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/**
 * Actor information for events - identifies who or what triggered the event.
 */
export interface EventActor {
  type: 'user' | 'service'
  principalId?: string
  userId?: string
  email?: string
  /** Display name of the actor (user name or service principal name) */
  displayName?: string
  /** Service name if triggered by service principal (e.g., 'linear-integration') */
  service?: string
}

// ============================================================================
// Event Payload Types
// ============================================================================

/**
 * Post data included in post.created events.
 */
export interface EventPostData {
  id: string
  title: string
  content: string
  boardId: string
  boardSlug: string
  authorEmail?: string
  authorName?: string
  voteCount: number
}

/**
 * Minimal post reference used in status change and comment events.
 */
export interface EventPostRef {
  id: string
  title: string
  boardId: string
  boardSlug: string
}

/**
 * Comment data included in comment.created events.
 */
export interface EventCommentData {
  id: string
  content: string
  authorEmail?: string
  authorName?: string
  isPrivate?: boolean
}

export interface PostCreatedPayload {
  post: EventPostData
}

export interface PostStatusChangedPayload {
  post: EventPostRef
  previousStatus: string
  newStatus: string
}

export interface CommentCreatedPayload {
  comment: EventCommentData
  post: EventPostRef
}

/**
 * Payload for post.mentioned events — fired once per newly-mentioned principal
 * when a post is created or edited.
 */
export interface EventPostMentionedData {
  postId: string
  postTitle: string
  postUrl: string
  /** Board the post lives on; lets webhook board filters apply. */
  boardId?: string
  mentionedPrincipalId: string
  mentioningPrincipalId: string
  /** Text of the paragraph containing the mention (≤200 chars), used as email body context. */
  excerpt: string
}

export interface PostUpdatedPayload {
  post: EventPostRef
  changedFields: string[]
}

/**
 * Payload for post.owner_assigned — fired when a post's owner is set to a
 * different principal. Self-contained (no DB round-trip needed downstream),
 * mirroring post.mentioned's shape rather than nesting an EventPostRef.
 */
/**
 * Payload for post.subscriber_added / post.subscriber_removed: a subscription
 * to a post's thread changed by hand. The actor is whoever changed it, the
 * subscriber whose subscription it is; they are the same person when someone
 * follows or unfollows a post themselves. Ids only, no name or email:
 * consumers hydrate the principal by id.
 */
export interface PostSubscriberChangedPayload {
  post: EventPostRef
  subscriberPrincipalId: string
  /** Why the subscriber follows (added) or followed (removed) the post. */
  reason: string | null
}

export interface PostOwnerAssignedPayload {
  postId: string
  postTitle: string
  boardSlug: string
  postUrl: string
  /** Board the post lives on; lets webhook board filters apply. */
  boardId?: string
  ownerPrincipalId: string
  previousOwnerPrincipalId: string | null
}

export interface PostDeletedPayload {
  post: EventPostRef
  deletedBy?: string
}

export interface PostRestoredPayload {
  post: EventPostRef
}

/**
 * A vote cast on a post. Fires only when a vote is ADDED — the toggle-off
 * half of voteOnPost and removeVote never emit it. Voter identity is
 * best-effort: anonymous voters carry null email/name (their synthetic
 * placeholder email is stripped at the emit site), and the count is the
 * post's vote_count immediately after this vote landed.
 */
export interface PostVotedPayload {
  post: EventPostRef
  voterEmail?: string | null
  voterName?: string | null
  voteCount: number
}

export interface PostMergedPayload {
  duplicatePost: EventPostRef
  canonicalPost: EventPostRef
}

export interface PostUnmergedPayload {
  post: EventPostRef
  formerCanonicalPost: EventPostRef
}

export interface CommentUpdatedPayload {
  comment: EventCommentData
  post: EventPostRef
}

export interface CommentDeletedPayload {
  comment: { id: string; isPrivate?: boolean }
  post: EventPostRef
}

export interface ChangelogPublishedPayload {
  changelog: {
    id: string
    title: string
    contentPreview: string
    contentHtml: string
    publishedAt: string
    linkedPostCount: number
  }
}

// Status page events (Status Product Spec §9). Email fires only on the two
// publish events (incident_created, maintenance_scheduled); the rest reach
// in-app + webhooks/workflows only.
export interface StatusIncidentEventData {
  id: string
  kind: 'incident' | 'maintenance'
  title: string
  status: string
  impact: string
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  startedAt: string
  componentIds: string[]
  /** On the publish events: false when the publication does not email subscribers. */
  notifySubscribers?: boolean
}

/** status.incident_created + status.maintenance_scheduled (the publish events). */
export interface StatusIncidentPublishedPayload {
  incident: StatusIncidentEventData
}

export interface StatusIncidentUpdatedPayload {
  incidentId: string
  kind: 'incident' | 'maintenance'
  status: string
  body: string
}

/** status.maintenance_started + status.maintenance_completed. */
export interface StatusMaintenanceTransitionPayload {
  incidentId: string
  title: string
  componentIds: string[]
}

export interface StatusComponentChangedPayload {
  componentId: string
  componentName: string
  previousStatus: string
  status: string
  source: string
}

// Conversation / message events
export interface EventConversationRef {
  id: string
  status: ConversationStatus
  channel: Channel
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  /** The assigned team (§4.12), when set. Optional so pre-teams payloads and
   *  refs that don't carry assignment stay unchanged. */
  assignedTeamId?: string | null
}

export interface EventConversationData extends EventConversationRef {
  subject: string | null
  visitorPrincipalId: string
  visitorEmail: string | null // realEmail() — null for anonymous visitors
  assignedAgentPrincipalId: string | null
  createdAt: string
  lastMessageAt: string
  resolvedAt: string | null
}

export interface EventMessageData {
  id: string
  conversationId: string
  senderType: 'visitor' | 'agent'
  authorPrincipalId: string | null
  authorName: string | null
  authorEmail: string | null // realEmail()
  content: string
  createdAt: string
}

export interface ConversationCreatedPayload {
  conversation: EventConversationData
}
export interface ConversationStatusChangedPayload {
  conversation: EventConversationRef
  previousStatus: string
  newStatus: string
}
/**
 * Symmetric with TicketAssignedPayload: an assignment can change the agent
 * and/or the team independently (conversation.service's assignTeam can move
 * the team while leaving the agent untouched, and vice versa), so both sides
 * carry their own current + previous value.
 */
export interface ConversationAssignedPayload {
  conversation: EventConversationRef
  assignedAgentPrincipalId: string | null
  previousAgentPrincipalId: string | null
  assignedTeamId: string | null
  previousTeamId: string | null
}
export interface ConversationPriorityChangedPayload {
  conversation: EventConversationRef
  previousPriority: string
  newPriority: string
}
/**
 * Payload for conversation.attribute_changed — fired when a conversation
 * attribute is set or cleared by AI, a teammate, or a customer (never for a
 * workflow's own `set_attribute` action; see set-attribute.service.ts's
 * emit-site doc for the loop-prevention rule). `value` is the
 * envelope-unwrapped primitive (null on unset), never the `{ v, src, at }`
 * storage wrapper. `conversation` carries the same ref every sibling
 * conversation event embeds (status/channel/priority/assignedTeamId) —
 * `conversationId` is kept alongside it for back-compat with existing
 * consumers that read the bare id.
 */
export interface ConversationAttributeChangedPayload {
  conversationId: string
  conversation: EventConversationRef
  key: string
  value: JsonValue | null
  source: ConversationAttributeSource
}
export interface ConversationCsatSubmittedPayload {
  conversation: EventConversationRef
  rating: number
  comment: string | null
  submittedAt: string
}
export interface ConversationCsatCommentAddedPayload {
  conversation: EventConversationRef
  rating: number
  comment: string
  submittedAt: string
}
/**
 * Payload for conversation.note_mentioned — fired once per internal note that
 * newly @-mentions one or more teammates (WO-3 slice 3, replaces the direct
 * notification write in sync-conversation-mentions.ts). Notification-only:
 * never a workflow trigger. `mentionedPrincipalIds` is already
 * eligibility-filtered (team-only) and author-excluded by the emit site, so
 * consumers can treat it as the final recipient set.
 */
export interface ConversationNoteMentionedPayload {
  conversationId: string
  conversationMessageId: string
  mentionedPrincipalIds: string[]
  authorName: string
  /** Plain-text note preview (≤140 chars), used as the notification body. */
  preview: string
}
export interface MessageCreatedPayload {
  message: EventMessageData
  conversation: EventConversationRef
  /**
   * Whether this is the conversation's first message. Only meaningful for a
   * visitor-sent message (the service knows this at send time; NEVER
   * re-derive it by counting messages in the worker — it races). Drives the
   * team bell's anti-spam gate (WO-3 slice 5): the bell fires on the first
   * message of a conversation, or when no agent is online, matching the
   * pre-move `notifyVisitorMessage` gate exactly.
   */
  isFirstMessage: boolean
}
export interface MessageNoteCreatedPayload {
  message: EventMessageData
  conversation: EventConversationRef
}
export interface MessageDeletedPayload {
  message: { id: string; conversationId: string }
  conversation: EventConversationRef
}
export interface MessageUpdatedPayload {
  message: EventMessageData
  conversation: EventConversationRef
  editedAt: string
}

// Ticket events (support platform §4.2). A ticket is a tracked-work peer of the
// conversation; these are the agent/integration-facing lifecycle signals (the
// customer-facing signal is the in-app bell + thread status event, not a hook).
export type EventTicketType = 'customer' | 'back_office' | 'tracker'

/** Minimal ticket reference. The ticket row does not denormalize its status
 *  category or public stage (both live on ticket_statuses), so the ref carries
 *  neither — status.created reports them once, status_changed reports the move. */
export interface EventTicketRef {
  id: string
  number: number
  type: EventTicketType
  /** The registry type (convergence Phase 4), null for legacy typeless rows.
   *  Optional on the wire: pre-Phase-4 historical payloads lack the key. */
  ticketTypeId?: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  assignedPrincipalId?: string | null
  assignedTeamId?: string | null
  /** The ticket's shared due date (ISO), null when none. Optional on the
   *  wire: payloads recorded before due dates shipped lack the key. */
  dueAt?: string | null
}

export interface EventTicketData extends EventTicketRef {
  title: string
  /** Internal status category — the ticket's lifecycle axis. */
  status: 'open' | 'pending' | 'closed'
  /** Customer-facing public stage, or null when the status projects no stage. */
  stage: string | null
  requesterPrincipalId: string | null
  companyId: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface TicketCreatedPayload {
  ticket: EventTicketData
}
export interface TicketStatusChangedPayload {
  ticket: EventTicketRef
  /** Internal status category, not the raw status name. */
  previousStatus: string
  newStatus: string
  /** The new public stage projection (null when hidden). */
  stage: string | null
  /**
   * The public stage projection BEFORE this move — unrecoverable once the
   * status UPDATE commits (the previous status row's own publicStage isn't
   * carried anywhere else), so the emit site captures it before the write and
   * threads it through here for the requester-bell resolver's crossing check.
   */
  previousStage: string | null
  /** The ticket's requester, or null for a back-office/tracker ticket with
   *  none — needed by the requester-bell resolver, which has no other way to
   *  look up "who owns this ticket" from the ref alone. */
  requesterPrincipalId: string | null
  /** The ticket's title — `EventTicketRef` carries no title, but the
   *  requester-bell notification copy needs it. */
  title: string
}
export interface TicketAssignedPayload {
  ticket: EventTicketRef
  assignedPrincipalId: string | null
  previousPrincipalId: string | null
  assignedTeamId: string | null
  previousTeamId: string | null
}

/**
 * Payload for ticket.external_status_changed — a tracker issue linked to this
 * ticket changed status on the external platform. Fired per linked ticket by
 * the inbound webhook path BEFORE (and regardless of) status-mapping
 * resolution, so an unmapped or same-status move still reaches agent watchers.
 * Reference/url come from the stored link row (the inbound payload carries
 * neither); `transition` is the provider-stated open/closed semantic when
 * available (see InboundWebhookResult.transition), refining notification copy
 * from "moved to X" to "was closed"/"was reopened".
 */
export interface TicketExternalStatusChangedPayload {
  ticket: EventTicketRef
  /** Ticket title — the ref carries no title, notification copy needs it. */
  title: string
  integrationType: string
  /** Human-readable issue reference from the link row (e.g. "acme/app#412"). */
  externalDisplayId: string | null
  externalUrl: string | null
  /** The provider's new status name (e.g. "Done", "Closed"). */
  externalStatus: string
  transition: 'closed' | 'reopened' | null
}

/**
 * Payload for ticket.due_changed: the due date was set, moved or cleared.
 * Not fired for a due date given at creation (ticket.created carries it on
 * the ticket ref).
 */
export interface TicketDueChangedPayload {
  ticket: EventTicketRef
  /** Ticket title, for notification copy (the ref carries no title). */
  title: string
  /** The new due date (ISO), null when cleared. */
  dueAt: string | null
  /** The due date before this change (ISO), null when there was none. */
  previousDueAt: string | null
}

/**
 * Payload for the two ticket-due timer events, ticket.due_soon (within the
 * next 24 hours) and ticket.overdue (the due date passed while the ticket is
 * still open). Each fires at most once per ticket per due date.
 */
export interface TicketDueAlertPayload {
  ticket: EventTicketRef
  title: string
  /** The due date the alert is about (ISO). */
  dueAt: string
}

/**
 * Payload for ticket.subscriber_added / ticket.subscriber_removed: a watch
 * changed by hand. The actor is whoever changed it, the subscriber whose watch
 * it is; they are the same person for a self watch or unwatch. Ids only, no
 * name or email: consumers hydrate the principal by id.
 */
export interface TicketSubscriberChangedPayload {
  ticket: EventTicketRef
  /** Ticket title — the ref carries no title, notification copy needs it. */
  title: string
  subscriberPrincipalId: string
  /** Why the subscriber watches (added) or watched (removed) the ticket. */
  reason: string | null
}

/**
 * Payload for ticket.updated: an editable ticket field changed. Today the only
 * such field is the title, so `changedKeys` is always `['title']`; the list
 * leaves room for more without a new event per field (CONTRACT.md §3).
 */
export interface TicketUpdatedPayload {
  ticket: EventTicketRef
  /** The title after the change. */
  title: string
  /** The title before the change. */
  previousTitle: string
  changedKeys: string[]
}

/** Payload for ticket.priority_changed (mirrors conversation.priority_changed). */
export interface TicketPriorityChangedPayload {
  ticket: EventTicketRef
  /** Ticket title, for consumer copy (the ref carries no title). */
  title: string
  previousPriority: string
  newPriority: string
}

/** Payload for ticket.reply_updated: a public reply's body was edited. Carries
 *  the reply's new body in the same shape ticket.replied delivers it. */
export interface TicketReplyUpdatedPayload extends EventTicketMessageData {
  /** When the edit landed (ISO). */
  editedAt: string
}

/** Payload for ticket.reply_deleted: a public reply was removed from the
 *  thread. Carries no body: the content is gone. */
export interface TicketReplyDeletedPayload {
  ticket: EventTicketRef
  messageId: string
  senderType: 'agent' | 'visitor'
  /** Ticket title, for consumer copy (the ref carries no title). */
  title: string
}

/** Payload for ticket.attachment_added / ticket.attachment_removed: one file
 *  added to or removed from a public reply already sent. */
export interface TicketAttachmentChangedPayload {
  ticket: EventTicketRef
  messageId: string
  senderType: 'agent' | 'visitor'
  /** Ticket title, for consumer copy (the ref carries no title). */
  title: string
  attachment: EventTicketMessageAttachment
}

/** A message attachment carried on a ticket reply/note event. */
export interface EventTicketMessageAttachment {
  name: string
  url: string
  contentType: string
  size: number
}

/**
 * Shared payload for the two ticket-thread message events (ticket.replied,
 * ticket.note_added). Carries the ticket ref plus the new message's markdown
 * content (images preserved from the stored contentJson), its attachments, and
 * who sent it. Note content is included in full: ticket events reach only
 * admin-configured consumers (webhooks gated by webhook.manage, integration
 * mappings), never a per-user or public subscription — the same trust model
 * under which message.note_created already ships full internal-note content.
 */
export interface EventTicketMessageData {
  ticket: EventTicketRef
  messageId: string
  /** Markdown-rendered content — images preserved from the stored contentJson. */
  content: string
  attachments: EventTicketMessageAttachment[] | null
  /** 'agent' for a teammate reply or internal note; 'visitor' for a requester reply. */
  senderType: 'agent' | 'visitor'
  /** Ticket title, for notification copy (mirrors ticket.status_changed's extra). */
  title: string
  /** Message author's display name; null when the author has none. */
  authorName: string | null
  /** Requester principal, on `ticket.replied` only — lets per-recipient
   *  notification metadata mark the requester's row portal-audience. */
  requesterPrincipalId?: string | null
}

/**
 * Payload for assistant.handed_off — fired when Quinn escalates a conversation
 * to the human team, once per hand-off decision.
 */
export interface AssistantHandedOffPayload {
  conversationId: string
  reason: string
}

export interface AssistantResolvedPayload {
  conversationId: string
  outcome: string
}

/**
 * Payload shared by conversation.customer_unresponsive / teammate_unresponsive
 * (support platform §4.6, timer-driven triggers). `workflowId` targets the ONE
 * live workflow workflow-sweep.ts already determined crossed ITS OWN
 * `inactivityMinutes` threshold — see dispatcher.ts's dispatchWorkflowTrigger
 * `targetWorkflowId` for why this routes to a single workflow instead of the
 * generic fan-out every other trigger uses. `sinceAt` is the stable anchor (the conversation's
 * `waitingSince` for teammate_unresponsive, `lastMessageAt` for
 * customer_unresponsive) the firing was keyed on — carried through so a
 * consumer can compute the exact silence window without a second read.
 * `conversation` carries the same ref every sibling conversation event
 * embeds — `conversationId` is kept alongside it for back-compat.
 */
export interface ConversationUnresponsivePayload {
  conversationId: string
  conversation: EventConversationRef
  workflowId: string
  silenceMinutes: number
  sinceAt: string // ISO
}

/**
 * Payload shared by sla.approaching_breach / sla.breached (support platform
 * §4.6, timer-driven triggers). Dispatched via the standard multi-workflow
 * fan-out (unlike the unresponsive pair above) since the SLA domain's
 * fire-once dedupe is a CAS-guarded marker scoped per (conversation, clock),
 * not per workflow — see sla.service.ts's sweepApproachingSlaBreaches /
 * sweepSlaBreachTriggers doc for the trade-off this implies when more than
 * one live workflow subscribes with different `breachLeadMinutes`.
 * `conversation` carries the same ref every sibling conversation event
 * embeds — `conversationId` is kept alongside it for back-compat.
 *
 * The `time_to_resolve` clock is TICKET-anchored (ticket-sla.service.ts): the
 * conversation side of the payload then points at the ticket's linked
 * CUSTOMER conversation (all workflow runs are conversation-context, so the
 * trigger rides that anchor), and `ticketId`/`ticket` identify the ticket
 * whose TTR clock actually fired. Both are absent for conversation clocks.
 */
export interface SlaTimerPayload {
  conversationId: string
  conversation: EventConversationRef
  clock: 'first_response' | 'next_response' | 'resolution' | 'time_to_resolve'
  dueAt: string // ISO
  /** Ticket-anchored TTR clocks only: the ticket whose clock fired. */
  ticketId?: string
  ticket?: EventTicketRef
}

// ============================================================================
// Event Data (Discriminated Union)
// ============================================================================

interface EventBase<T extends EventType> {
  id: string
  type: T
  timestamp: string
  actor: EventActor
}

export interface PostCreatedEvent extends EventBase<'post.created'> {
  data: PostCreatedPayload
}

export interface PostStatusChangedEvent extends EventBase<'post.status_changed'> {
  data: PostStatusChangedPayload
}

export interface PostUpdatedEvent extends EventBase<'post.updated'> {
  data: PostUpdatedPayload
}

export interface PostDeletedEvent extends EventBase<'post.deleted'> {
  data: PostDeletedPayload
}

export interface PostRestoredEvent extends EventBase<'post.restored'> {
  data: PostRestoredPayload
}

export interface PostVotedEvent extends EventBase<'post.voted'> {
  data: PostVotedPayload
}

export interface PostMergedEvent extends EventBase<'post.merged'> {
  data: PostMergedPayload
}

export interface PostUnmergedEvent extends EventBase<'post.unmerged'> {
  data: PostUnmergedPayload
}

export interface CommentCreatedEvent extends EventBase<'comment.created'> {
  data: CommentCreatedPayload
}

export interface CommentUpdatedEvent extends EventBase<'comment.updated'> {
  data: CommentUpdatedPayload
}

export interface CommentDeletedEvent extends EventBase<'comment.deleted'> {
  data: CommentDeletedPayload
}

export interface ChangelogPublishedEvent extends EventBase<'changelog.published'> {
  data: ChangelogPublishedPayload
}

export interface StatusIncidentCreatedEvent extends EventBase<'status.incident_created'> {
  data: StatusIncidentPublishedPayload
}
export interface StatusMaintenanceScheduledEvent extends EventBase<'status.maintenance_scheduled'> {
  data: StatusIncidentPublishedPayload
}
export interface StatusIncidentUpdatedEvent extends EventBase<'status.incident_updated'> {
  data: StatusIncidentUpdatedPayload
}
export interface StatusMaintenanceStartedEvent extends EventBase<'status.maintenance_started'> {
  data: StatusMaintenanceTransitionPayload
}
export interface StatusMaintenanceCompletedEvent extends EventBase<'status.maintenance_completed'> {
  data: StatusMaintenanceTransitionPayload
}
export interface StatusComponentChangedEvent extends EventBase<'status.component_changed'> {
  data: StatusComponentChangedPayload
}

export interface PostMentionedEvent extends EventBase<'post.mentioned'> {
  data: EventPostMentionedData
}
export interface PostSubscriberAddedEvent extends EventBase<'post.subscriber_added'> {
  data: PostSubscriberChangedPayload
}
export interface PostSubscriberRemovedEvent extends EventBase<'post.subscriber_removed'> {
  data: PostSubscriberChangedPayload
}
export interface PostOwnerAssignedEvent extends EventBase<'post.owner_assigned'> {
  data: PostOwnerAssignedPayload
}

export interface ConversationCreatedEvent extends EventBase<'conversation.created'> {
  data: ConversationCreatedPayload
}
export interface ConversationStatusChangedEvent extends EventBase<'conversation.status_changed'> {
  data: ConversationStatusChangedPayload
}
export interface ConversationAssignedEvent extends EventBase<'conversation.assigned'> {
  data: ConversationAssignedPayload
}
export interface ConversationPriorityChangedEvent extends EventBase<'conversation.priority_changed'> {
  data: ConversationPriorityChangedPayload
}
export interface ConversationAttributeChangedEvent extends EventBase<'conversation.attribute_changed'> {
  data: ConversationAttributeChangedPayload
}
export interface ConversationCsatSubmittedEvent extends EventBase<'conversation.csat_submitted'> {
  data: ConversationCsatSubmittedPayload
}
export interface ConversationCsatCommentAddedEvent extends EventBase<'conversation.csat_comment_added'> {
  data: ConversationCsatCommentAddedPayload
}
export interface ConversationNoteMentionedEvent extends EventBase<'conversation.note_mentioned'> {
  data: ConversationNoteMentionedPayload
}
export interface MessageCreatedEvent extends EventBase<'message.created'> {
  data: MessageCreatedPayload
}
export interface MessageNoteCreatedEvent extends EventBase<'message.note_created'> {
  data: MessageNoteCreatedPayload
}
export interface MessageDeletedEvent extends EventBase<'message.deleted'> {
  data: MessageDeletedPayload
}
export interface MessageUpdatedEvent extends EventBase<'message.updated'> {
  data: MessageUpdatedPayload
}
export interface TicketCreatedEvent extends EventBase<'ticket.created'> {
  data: TicketCreatedPayload
}
export interface TicketStatusChangedEvent extends EventBase<'ticket.status_changed'> {
  data: TicketStatusChangedPayload
}
export interface TicketAssignedEvent extends EventBase<'ticket.assigned'> {
  data: TicketAssignedPayload
}
export interface TicketRepliedEvent extends EventBase<'ticket.replied'> {
  data: EventTicketMessageData
}
export interface TicketNoteAddedEvent extends EventBase<'ticket.note_added'> {
  data: EventTicketMessageData
}
export interface TicketExternalStatusChangedEvent extends EventBase<'ticket.external_status_changed'> {
  data: TicketExternalStatusChangedPayload
}
export interface TicketDueChangedEvent extends EventBase<'ticket.due_changed'> {
  data: TicketDueChangedPayload
}
export interface TicketDueSoonEvent extends EventBase<'ticket.due_soon'> {
  data: TicketDueAlertPayload
}
export interface TicketOverdueEvent extends EventBase<'ticket.overdue'> {
  data: TicketDueAlertPayload
}
export interface TicketSubscriberAddedEvent extends EventBase<'ticket.subscriber_added'> {
  data: TicketSubscriberChangedPayload
}
export interface TicketSubscriberRemovedEvent extends EventBase<'ticket.subscriber_removed'> {
  data: TicketSubscriberChangedPayload
}

export interface TicketUpdatedEvent extends EventBase<'ticket.updated'> {
  data: TicketUpdatedPayload
}
export interface TicketPriorityChangedEvent extends EventBase<'ticket.priority_changed'> {
  data: TicketPriorityChangedPayload
}
export interface TicketReplyUpdatedEvent extends EventBase<'ticket.reply_updated'> {
  data: TicketReplyUpdatedPayload
}
export interface TicketReplyDeletedEvent extends EventBase<'ticket.reply_deleted'> {
  data: TicketReplyDeletedPayload
}
export interface TicketAttachmentAddedEvent extends EventBase<'ticket.attachment_added'> {
  data: TicketAttachmentChangedPayload
}
export interface TicketAttachmentRemovedEvent extends EventBase<'ticket.attachment_removed'> {
  data: TicketAttachmentChangedPayload
}

export interface AssistantHandedOffEvent extends EventBase<'assistant.handed_off'> {
  data: AssistantHandedOffPayload
}

export interface AssistantResolvedEvent extends EventBase<'assistant.resolved'> {
  data: AssistantResolvedPayload
}

export interface ConversationCustomerUnresponsiveEvent extends EventBase<'conversation.customer_unresponsive'> {
  data: ConversationUnresponsivePayload
}
export interface ConversationTeammateUnresponsiveEvent extends EventBase<'conversation.teammate_unresponsive'> {
  data: ConversationUnresponsivePayload
}
export interface SlaApproachingBreachEvent extends EventBase<'sla.approaching_breach'> {
  data: SlaTimerPayload
}
export interface SlaBreachedEvent extends EventBase<'sla.breached'> {
  data: SlaTimerPayload
}

/**
 * What every approval event says about its request: the server-written
 * summary and the risk tier, never the requested content itself.
 */
export interface ApprovalRefPayload {
  approvalId: string
  toolName: string
  summary: string
  risk: 'low' | 'medium' | 'high' | 'critical'
}
export interface ApprovalRequestedPayload extends ApprovalRefPayload {
  requestedVia: 'ui' | 'api' | 'mcp' | 'assistant' | 'workflow'
  clientName?: string | null
  conversationId: string | null
  ticketId: string | null
  expiresAt: string // ISO
}
export interface ApprovalDecidedPayload extends ApprovalRefPayload {
  decision: 'approved' | 'rejected'
  decidedById: string
  decidedVia: 'app' | 'email' | 'assistant' | 'slack'
  reason?: string | null
}
export interface ApprovalAppliedPayload extends ApprovalRefPayload {
  appliedById: string | null
}
export interface ApprovalRequestedEvent extends EventBase<'approval.requested'> {
  data: ApprovalRequestedPayload
}
export interface ApprovalDecidedEvent extends EventBase<'approval.decided'> {
  data: ApprovalDecidedPayload
}
export interface ApprovalAppliedEvent extends EventBase<'approval.applied'> {
  data: ApprovalAppliedPayload
}

/**
 * Event data - discriminated union of all event types.
 *
 * Use type narrowing to access event-specific data:
 * @example
 * if (event.type === 'post.created') {
 *   const title = event.data.post.title
 * }
 */
export type EventData =
  | PostCreatedEvent
  | PostStatusChangedEvent
  | PostUpdatedEvent
  | PostDeletedEvent
  | PostRestoredEvent
  | PostVotedEvent
  | PostMergedEvent
  | PostUnmergedEvent
  | PostMentionedEvent
  | PostOwnerAssignedEvent
  | PostSubscriberAddedEvent
  | PostSubscriberRemovedEvent
  | CommentCreatedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent
  | ChangelogPublishedEvent
  | StatusIncidentCreatedEvent
  | StatusMaintenanceScheduledEvent
  | StatusIncidentUpdatedEvent
  | StatusMaintenanceStartedEvent
  | StatusMaintenanceCompletedEvent
  | StatusComponentChangedEvent
  | ConversationCreatedEvent
  | ConversationStatusChangedEvent
  | ConversationAssignedEvent
  | ConversationPriorityChangedEvent
  | ConversationAttributeChangedEvent
  | ConversationCsatSubmittedEvent
  | ConversationCsatCommentAddedEvent
  | ConversationNoteMentionedEvent
  | MessageCreatedEvent
  | MessageNoteCreatedEvent
  | MessageDeletedEvent
  | MessageUpdatedEvent
  | TicketCreatedEvent
  | TicketStatusChangedEvent
  | TicketAssignedEvent
  | TicketRepliedEvent
  | TicketNoteAddedEvent
  | TicketExternalStatusChangedEvent
  | TicketDueChangedEvent
  | TicketDueSoonEvent
  | TicketOverdueEvent
  | TicketSubscriberAddedEvent
  | TicketSubscriberRemovedEvent
  | TicketUpdatedEvent
  | TicketPriorityChangedEvent
  | TicketReplyUpdatedEvent
  | TicketReplyDeletedEvent
  | TicketAttachmentAddedEvent
  | TicketAttachmentRemovedEvent
  | AssistantHandedOffEvent
  | AssistantResolvedEvent
  | ConversationCustomerUnresponsiveEvent
  | ConversationTeammateUnresponsiveEvent
  | SlaApproachingBreachEvent
  | SlaBreachedEvent
  | ApprovalRequestedEvent
  | ApprovalDecidedEvent
  | ApprovalAppliedEvent
