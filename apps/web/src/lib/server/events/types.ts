/**
 * Event system types.
 */
import type { ConversationStatus } from '@/lib/shared/db-types'
import type { JsonValue } from '@/lib/shared/json'
import type { ConversationAttributeSource } from '@/lib/shared/conversation/attribute-values'

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
  'ticket.created',
  'ticket.status_changed',
  'ticket.assigned',
  'ticket.replied',
  'ticket.note_added',
  'assistant.handed_off',
  // Timer-driven triggers (see TIMER_DRIVEN_EVENT_TYPES above for the rationale).
  ...TIMER_DRIVEN_EVENT_TYPES,
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
  mentionedPrincipalId: string
  mentioningPrincipalId: string
  /** Text of the paragraph containing the mention (≤200 chars), used as email body context. */
  excerpt: string
}

export interface PostUpdatedPayload {
  post: EventPostRef
  changedFields: string[]
}

export interface PostDeletedPayload {
  post: EventPostRef
  deletedBy?: string
}

export interface PostRestoredPayload {
  post: EventPostRef
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
  channel: 'messenger' | 'email' | 'web_form'
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
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  assignedPrincipalId?: string | null
  assignedTeamId?: string | null
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
}

/**
 * Payload for assistant.handed_off — fired when Quinn escalates a conversation
 * to the human team, once per hand-off decision.
 */
export interface AssistantHandedOffPayload {
  conversationId: string
  reason: string
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
 */
export interface SlaTimerPayload {
  conversationId: string
  conversation: EventConversationRef
  clock: 'first_response' | 'resolution'
  dueAt: string // ISO
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

export interface AssistantHandedOffEvent extends EventBase<'assistant.handed_off'> {
  data: AssistantHandedOffPayload
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
  | PostMergedEvent
  | PostUnmergedEvent
  | PostMentionedEvent
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
  | TicketCreatedEvent
  | TicketStatusChangedEvent
  | TicketAssignedEvent
  | TicketRepliedEvent
  | TicketNoteAddedEvent
  | AssistantHandedOffEvent
  | ConversationCustomerUnresponsiveEvent
  | ConversationTeammateUnresponsiveEvent
  | SlaApproachingBreachEvent
  | SlaBreachedEvent
