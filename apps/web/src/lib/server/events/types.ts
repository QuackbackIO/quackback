/**
 * Event system types.
 */

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
  // Ticketing (Phase 7.5)
  'ticket.created',
  'ticket.updated',
  'ticket.deleted',
  'ticket.restored',
  'ticket.assigned',
  'ticket.unassigned',
  'ticket.status_changed',
  'ticket.first_response',
  'ticket.thread_added',
  'ticket.thread_updated',
  'ticket.thread_deleted',
  'ticket.participant_added',
  'ticket.participant_removed',
  'ticket.shared',
  'ticket.unshared',
  'ticket.sla_warning',
  'ticket.sla_breach',
  'ticket.attachment_added',
  'ticket.attachment_removed',
  // Configuration plane (Phase 6) — admin CRUD over inboxes / teams / statuses
  'inbox.created',
  'inbox.updated',
  'inbox.archived',
  'inbox.unarchived',
  'team.created',
  'team.updated',
  'team.archived',
  'ticket_status.created',
  'ticket_status.updated',
  // CRM (Phase 5) — contacts and organizations
  'contact.created',
  'contact.updated',
  'contact.archived',
  'contact.linked',
  'contact.unlinked',
  'organization.created',
  'organization.updated',
  'organization.archived',
  'organization.unarchived',
  'conversation.created',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.priority_changed',
  'conversation.csat_submitted',
  'conversation.csat_comment_added',
  'message.created',
  'message.note_created',
  'message.deleted',
  // Help Center (Phase 2) — category & article CRUD
  'help_center.category.created',
  'help_center.category.updated',
  'help_center.category.deleted',
  'help_center.article.created',
  'help_center.article.updated',
  'help_center.article.published',
  'help_center.article.unpublished',
  'help_center.article.deleted',
  // Changelog (Phase 2) — entry CRUD ('changelog.published' already exists)
  'changelog.created',
  'changelog.updated',
  'changelog.deleted',
  // Audience (Phase 2) — segments & user-attribute definitions
  'segment.created',
  'segment.updated',
  'segment.deleted',
  'user_attribute.created',
  'user_attribute.updated',
  'user_attribute.deleted',
  // Feedback configuration (Phase 8) — boards, tags, statuses, roadmaps
  'board.created',
  'board.updated',
  'board.deleted',
  'tag.created',
  'tag.updated',
  'tag.deleted',
  'status.created',
  'status.updated',
  'status.deleted',
  'roadmap.created',
  'roadmap.updated',
  'roadmap.deleted',
  // Support configuration (Phase 8) — SLA, routing, business hours, channels, memberships
  'sla_policy.created',
  'sla_policy.updated',
  'sla_policy.archived',
  'routing_rule.created',
  'routing_rule.updated',
  'routing_rule.deleted',
  'business_hours.created',
  'business_hours.updated',
  'business_hours.archived',
  'inbox_channel.created',
  'inbox_channel.updated',
  'inbox_channel.archived',
  'inbox_membership.added',
  'inbox_membership.updated',
  'inbox_membership.removed',
  // Administration / security (Phase 8) — API keys, roles, role assignments
  'api_key.created',
  'api_key.rotated',
  'api_key.revoked',
  'role.created',
  'role.updated',
  'role.deleted',
  'role_assignment.created',
  'role_assignment.revoked',
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

// Conversation / message events
export interface EventConversationRef {
  id: string
  status: 'open' | 'pending' | 'closed'
  channel: 'messenger' | 'email' | 'web_form'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
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
export interface ConversationAssignedPayload {
  conversation: EventConversationRef
  assignedAgentPrincipalId: string | null
  previousAgentPrincipalId: string | null
}
export interface ConversationPriorityChangedPayload {
  conversation: EventConversationRef
  previousPriority: string
  newPriority: string
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
export interface MessageCreatedPayload {
  message: EventMessageData
  conversation: EventConversationRef
}
export interface MessageNoteCreatedPayload {
  message: EventMessageData
  conversation: EventConversationRef
}
export interface MessageDeletedPayload {
  message: { id: string; conversationId: string }
  conversation: EventConversationRef
}

// ============================================================================
// Event Data (Discriminated Union)
// ============================================================================

interface EventBase<T extends EventType> {
  id: string
  type: T
  timestamp: string
  actor: EventActor
  /**
   * Set by inbound integration handlers to prevent echo loops.
   * When present, the dispatcher skips integration targets whose
   * integrationId matches this value.
   */
  syncSourceIntegrationId?: string
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
export interface ConversationCsatSubmittedEvent extends EventBase<'conversation.csat_submitted'> {
  data: ConversationCsatSubmittedPayload
}
export interface ConversationCsatCommentAddedEvent extends EventBase<'conversation.csat_comment_added'> {
  data: ConversationCsatCommentAddedPayload
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
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketDeletedEvent
  | TicketRestoredEvent
  | TicketAssignedEvent
  | TicketUnassignedEvent
  | TicketStatusChangedEvent
  | TicketFirstResponseEvent
  | TicketThreadAddedEvent
  | TicketThreadUpdatedEvent
  | TicketThreadDeletedEvent
  | TicketParticipantAddedEvent
  | TicketParticipantRemovedEvent
  | TicketSharedEvent
  | TicketUnsharedEvent
  | TicketSlaWarningEvent
  | TicketSlaBreachEvent
  | TicketAttachmentAddedEvent
  | TicketAttachmentRemovedEvent
  | InboxCreatedEvent
  | InboxUpdatedEvent
  | InboxArchivedEvent
  | InboxUnarchivedEvent
  | TeamCreatedEvent
  | TeamUpdatedEvent
  | TeamArchivedEvent
  | TicketStatusCreatedEvent
  | TicketStatusUpdatedEvent
  | ContactCreatedEvent
  | ContactUpdatedEvent
  | ContactArchivedEvent
  | ContactLinkedEvent
  | ContactUnlinkedEvent
  | OrganizationCreatedEvent
  | OrganizationUpdatedEvent
  | OrganizationArchivedEvent
  | OrganizationUnarchivedEvent
  | ConversationCreatedEvent
  | ConversationStatusChangedEvent
  | ConversationAssignedEvent
  | ConversationPriorityChangedEvent
  | ConversationCsatSubmittedEvent
  | ConversationCsatCommentAddedEvent
  | MessageCreatedEvent
  | MessageNoteCreatedEvent
  | MessageDeletedEvent
  | HelpCenterCategoryCreatedEvent
  | HelpCenterCategoryUpdatedEvent
  | HelpCenterCategoryDeletedEvent
  | HelpCenterArticleCreatedEvent
  | HelpCenterArticleUpdatedEvent
  | HelpCenterArticlePublishedEvent
  | HelpCenterArticleUnpublishedEvent
  | HelpCenterArticleDeletedEvent
  | ChangelogCreatedEvent
  | ChangelogUpdatedEvent
  | ChangelogDeletedEvent
  | SegmentCreatedEvent
  | SegmentUpdatedEvent
  | SegmentDeletedEvent
  | UserAttributeCreatedEvent
  | UserAttributeUpdatedEvent
  | UserAttributeDeletedEvent
  | BoardCreatedEvent
  | BoardUpdatedEvent
  | BoardDeletedEvent
  | TagCreatedEvent
  | TagUpdatedEvent
  | TagDeletedEvent
  | StatusCreatedEvent
  | StatusUpdatedEvent
  | StatusDeletedEvent
  | RoadmapCreatedEvent
  | RoadmapUpdatedEvent
  | RoadmapDeletedEvent
  | SlaPolicyCreatedEvent
  | SlaPolicyUpdatedEvent
  | SlaPolicyArchivedEvent
  | RoutingRuleCreatedEvent
  | RoutingRuleUpdatedEvent
  | RoutingRuleDeletedEvent
  | BusinessHoursCreatedEvent
  | BusinessHoursUpdatedEvent
  | BusinessHoursArchivedEvent
  | InboxChannelCreatedEvent
  | InboxChannelUpdatedEvent
  | InboxChannelArchivedEvent
  | InboxMembershipAddedEvent
  | InboxMembershipUpdatedEvent
  | InboxMembershipRemovedEvent
  | ApiKeyCreatedEvent
  | ApiKeyRotatedEvent
  | ApiKeyRevokedEvent
  | RoleCreatedEvent
  | RoleUpdatedEvent
  | RoleDeletedEvent
  | RoleAssignmentCreatedEvent
  | RoleAssignmentRevokedEvent

// ============================================================================
// Ticket Events (Phase 7.5)
// ============================================================================

/**
 * Common ticket reference embedded in every ticket event.
 *
 * Channel/visibility are included so external integrations can filter
 * (e.g. only forward customer-facing tickets to Slack) without needing
 * to call back into the API.
 */
export interface EventTicketRef {
  id: string
  subject: string | null
  descriptionText: string | null
  statusId: string | null
  statusCategory: string | null
  priority: string | null
  channel: string | null
  visibility: string | null
  inboxId: string | null
  primaryTeamId: string | null
  assigneePrincipalId: string | null
  assigneeTeamId: string | null
  requesterPrincipalId: string | null
  requesterContactId: string | null
  // ---- Phase 3 enrichment: snapshot fields ---------------------------------
  // All fields below are snapshotted at dispatch time from joined tables so
  // that webhook receivers don't have to call back into the API. They are
  // optional on the type to keep the contract backwards compatible — older
  // code paths that build refs synchronously may still omit them.
  /** Display name of the ticket's status (e.g. "Open", "Solved"). */
  statusName?: string | null
  /** Display name of the inbox the ticket belongs to. */
  inboxName?: string | null
  /** URL-safe inbox slug. */
  inboxSlug?: string | null
  /** Display name of the team that owns the ticket queue. */
  primaryTeamName?: string | null
  /** Display name of the team currently assigned (if assigneeTeamId is set). */
  assigneeTeamName?: string | null
  /** Lowercased email of the requester contact, if known. */
  requesterEmail?: string | null
  /** Display name of the requester contact, if known. */
  requesterName?: string | null
  /** Organization name attached to the ticket / requester. */
  organizationName?: string | null
  /** Apex domain of the organization. */
  organizationDomain?: string | null
  /** Lifecycle timestamps (ISO strings). */
  createdAt?: string | null
  firstResponseAt?: string | null
  resolvedAt?: string | null
  reopenedAt?: string | null
  closedAt?: string | null
  /** Portal permalink — `${baseUrl}/tickets/{id}`. */
  ticketUrl?: string | null
}

export interface TicketCreatedPayload {
  ticket: EventTicketRef
}

export interface TicketUpdatedPayload {
  ticket: EventTicketRef
  /** Names of fields that changed (e.g. ['priority', 'primaryTeamId']). */
  changedFields: string[]
  /** Per-field before/after values. Mirrors the audit diff produced by the service. */
  diff: Record<string, { from: unknown; to: unknown }>
}

export interface TicketDeletedPayload {
  ticket: EventTicketRef
  deletedByPrincipalId: string | null
}

export interface TicketRestoredPayload {
  ticket: EventTicketRef
  restoredByPrincipalId: string | null
}

export interface TicketAssignedPayload {
  ticket: EventTicketRef
  previousAssigneePrincipalId: string | null
  newAssigneePrincipalId: string | null
}

export interface TicketUnassignedPayload {
  ticket: EventTicketRef
  previousAssigneePrincipalId: string | null
}

export interface TicketStatusChangedPayload {
  ticket: EventTicketRef
  previousStatusCategory: string | null
  newStatusCategory: string
}

export interface TicketFirstResponsePayload {
  ticket: EventTicketRef
  /** ID of the thread whose creation triggered first-response tracking. */
  threadId: string
  /** ISO timestamp of the moment first-response was recorded. */
  firstResponseAt: string
}

export interface TicketThreadAddedPayload {
  ticket: EventTicketRef
  threadId: string
  /**
   * Audience of the thread. External webhook delivery filters out
   * `internal` threads to avoid leaking private agent notes.
   */
  audience: 'public' | 'internal' | 'shared_team'
  sharedWithTeamId: string | null
  /**
   * Self-contained thread snapshot so webhook receivers don't need a second
   * round-trip to fetch the body. Optional for backwards compatibility with
   * older payloads — always populated by current dispatchers.
   */
  thread?: {
    id: string
    audience: 'public' | 'internal' | 'shared_team'
    /** First N chars of the plain-text body (capped, see `bodyTextTruncated`). */
    bodyTextPreview: string
    /** Plain-text body snapshot for notification/email consumers. */
    bodyText?: string
    bodyTextTruncated: boolean
    authorPrincipalId: string | null
    /** True when the thread author is the ticket's requester. */
    isFromRequester: boolean
    sharedWithTeamId: string | null
    /** ISO timestamp the thread was created. */
    createdAt: string
  }
}

export interface TicketThreadUpdatedPayload {
  ticket: EventTicketRef
  threadId: string
  audience: 'public' | 'internal' | 'shared_team'
  sharedWithTeamId: string | null
  thread: {
    id: string
    audience: 'public' | 'internal' | 'shared_team'
    bodyTextPreview: string
    bodyText?: string
    bodyTextTruncated: boolean
    authorPrincipalId: string | null
    isFromRequester: boolean
    sharedWithTeamId: string | null
    createdAt: string
    editedAt: string | null
  }
}

export interface TicketThreadDeletedPayload {
  ticket: EventTicketRef
  threadId: string
  audience: 'public' | 'internal' | 'shared_team'
  sharedWithTeamId: string | null
  deletedByPrincipalId: string | null
  thread?: {
    id: string
    audience: 'public' | 'internal' | 'shared_team'
    bodyTextPreview: string
    bodyText?: string
    bodyTextTruncated: boolean
    authorPrincipalId: string | null
    isFromRequester: boolean
    sharedWithTeamId: string | null
    createdAt: string
  }
}

export interface TicketParticipantAddedPayload {
  ticket: EventTicketRef
  addedPrincipalId: string | null
  role: string | null
}

export interface TicketParticipantRemovedPayload {
  ticket: EventTicketRef
  removedPrincipalId: string | null
}

export interface TicketSharedPayload {
  ticket: EventTicketRef
  teamId: string
  accessLevel: string | null
}

export interface TicketUnsharedPayload {
  ticket: EventTicketRef
  teamId: string
}

export interface TicketSlaWarningPayload {
  ticket: EventTicketRef
  kind: string
  ruleName: string
}

export interface TicketSlaBreachPayload {
  ticket: EventTicketRef
  kind: string
}

export interface TicketAttachmentAddedPayload {
  ticket: EventTicketRef
  attachment: {
    id: string
    threadId: string
    filename: string
    mimeType: string
    sizeBytes: number
    uploadedByPrincipalId: string | null
    /** Public URL when configured (e.g. S3 + CDN). storageKey is intentionally omitted. */
    publicUrl: string | null
  }
}

export interface TicketAttachmentRemovedPayload {
  ticket: EventTicketRef
  attachment: {
    id: string
    threadId: string
    filename: string
  }
  removedByPrincipalId: string | null
}

export interface TicketCreatedEvent extends EventBase<'ticket.created'> {
  data: TicketCreatedPayload
}
export interface TicketUpdatedEvent extends EventBase<'ticket.updated'> {
  data: TicketUpdatedPayload
}
export interface TicketDeletedEvent extends EventBase<'ticket.deleted'> {
  data: TicketDeletedPayload
}
export interface TicketRestoredEvent extends EventBase<'ticket.restored'> {
  data: TicketRestoredPayload
}
export interface TicketAssignedEvent extends EventBase<'ticket.assigned'> {
  data: TicketAssignedPayload
}
export interface TicketUnassignedEvent extends EventBase<'ticket.unassigned'> {
  data: TicketUnassignedPayload
}
export interface TicketStatusChangedEvent extends EventBase<'ticket.status_changed'> {
  data: TicketStatusChangedPayload
}
export interface TicketFirstResponseEvent extends EventBase<'ticket.first_response'> {
  data: TicketFirstResponsePayload
}
export interface TicketThreadAddedEvent extends EventBase<'ticket.thread_added'> {
  data: TicketThreadAddedPayload
}
export interface TicketThreadUpdatedEvent extends EventBase<'ticket.thread_updated'> {
  data: TicketThreadUpdatedPayload
}
export interface TicketThreadDeletedEvent extends EventBase<'ticket.thread_deleted'> {
  data: TicketThreadDeletedPayload
}
export interface TicketParticipantAddedEvent extends EventBase<'ticket.participant_added'> {
  data: TicketParticipantAddedPayload
}
export interface TicketParticipantRemovedEvent extends EventBase<'ticket.participant_removed'> {
  data: TicketParticipantRemovedPayload
}
export interface TicketSharedEvent extends EventBase<'ticket.shared'> {
  data: TicketSharedPayload
}
export interface TicketUnsharedEvent extends EventBase<'ticket.unshared'> {
  data: TicketUnsharedPayload
}
export interface TicketSlaWarningEvent extends EventBase<'ticket.sla_warning'> {
  data: TicketSlaWarningPayload
}
export interface TicketSlaBreachEvent extends EventBase<'ticket.sla_breach'> {
  data: TicketSlaBreachPayload
}
export interface TicketAttachmentAddedEvent extends EventBase<'ticket.attachment_added'> {
  data: TicketAttachmentAddedPayload
}
export interface TicketAttachmentRemovedEvent extends EventBase<'ticket.attachment_removed'> {
  data: TicketAttachmentRemovedPayload
}

// ============================================================================
// Configuration-plane events (Phase 6)
// ============================================================================

/**
 * Snapshot of an inbox embedded in `inbox.*` events. Mirrors the row shape so
 * receivers can mirror the inbox catalogue without calling back.
 */
export interface EventInboxRef {
  id: string
  slug: string
  name: string
  description: string | null
  primaryTeamId: string | null
  defaultVisibilityScope: string | null
  defaultPriority: string | null
  defaultStatusId: string | null
  color: string | null
  icon: string | null
  archivedAt: string | null
}

/** Snapshot of a team embedded in `team.*` events. */
export interface EventTeamRef {
  id: string
  slug: string
  name: string
  description: string | null
  shortLabel: string | null
  color: string | null
  archivedAt: string | null
}

/** Snapshot of a ticket status embedded in `ticket_status.*` events. */
export interface EventTicketStatusRef {
  id: string
  slug: string
  name: string
  color: string | null
  category: string
  position: number
  isDefault: boolean
  isSystem: boolean
  deletedAt: string | null
}

export interface InboxCreatedPayload {
  inbox: EventInboxRef
}

export interface InboxUpdatedPayload {
  inbox: EventInboxRef
  /** Names of fields that changed (e.g. ['name', 'primaryTeamId']). */
  changedFields: string[]
}

export interface InboxArchivedPayload {
  inbox: EventInboxRef
}

export interface InboxUnarchivedPayload {
  inbox: EventInboxRef
}

export interface TeamCreatedPayload {
  team: EventTeamRef
}

export interface TeamUpdatedPayload {
  team: EventTeamRef
  changedFields: string[]
}

export interface TeamArchivedPayload {
  team: EventTeamRef
}

export interface TicketStatusCreatedPayload {
  status: EventTicketStatusRef
}

export interface TicketStatusUpdatedPayload {
  status: EventTicketStatusRef
  changedFields: string[]
}

export interface InboxCreatedEvent extends EventBase<'inbox.created'> {
  data: InboxCreatedPayload
}
export interface InboxUpdatedEvent extends EventBase<'inbox.updated'> {
  data: InboxUpdatedPayload
}
export interface InboxArchivedEvent extends EventBase<'inbox.archived'> {
  data: InboxArchivedPayload
}
export interface InboxUnarchivedEvent extends EventBase<'inbox.unarchived'> {
  data: InboxUnarchivedPayload
}
export interface TeamCreatedEvent extends EventBase<'team.created'> {
  data: TeamCreatedPayload
}
export interface TeamUpdatedEvent extends EventBase<'team.updated'> {
  data: TeamUpdatedPayload
}
export interface TeamArchivedEvent extends EventBase<'team.archived'> {
  data: TeamArchivedPayload
}
export interface TicketStatusCreatedEvent extends EventBase<'ticket_status.created'> {
  data: TicketStatusCreatedPayload
}
export interface TicketStatusUpdatedEvent extends EventBase<'ticket_status.updated'> {
  data: TicketStatusUpdatedPayload
}

// ============================================================================
// CRM events (Phase 5) — contacts and organizations
// ============================================================================

/**
 * Snapshot of a contact embedded in `contact.*` events. Lean shape — omits
 * `metadata`, `avatarUrl`, `notes` (receivers can hydrate via REST GET if
 * they need more).
 */
export interface EventContactRef {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  title: string | null
  externalId: string | null
  organizationId: string | null
  archivedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** Snapshot of an organization embedded in `organization.*` events. */
export interface EventOrganizationRef {
  id: string
  name: string
  domain: string | null
  website: string | null
  externalId: string | null
  archivedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ContactCreatedPayload {
  contact: EventContactRef
}
export interface ContactUpdatedPayload {
  contact: EventContactRef
  changedFields: string[]
}
export interface ContactArchivedPayload {
  contact: EventContactRef
}
export interface ContactLinkedPayload {
  contact: EventContactRef
  userId: string
  linkedByPrincipalId: string | null
}
export interface ContactUnlinkedPayload {
  contact: EventContactRef
  userId: string
}
export interface OrganizationCreatedPayload {
  organization: EventOrganizationRef
}
export interface OrganizationUpdatedPayload {
  organization: EventOrganizationRef
  changedFields: string[]
}
export interface OrganizationArchivedPayload {
  organization: EventOrganizationRef
}
export interface OrganizationUnarchivedPayload {
  organization: EventOrganizationRef
}

export interface ContactCreatedEvent extends EventBase<'contact.created'> {
  data: ContactCreatedPayload
}
export interface ContactUpdatedEvent extends EventBase<'contact.updated'> {
  data: ContactUpdatedPayload
}
export interface ContactArchivedEvent extends EventBase<'contact.archived'> {
  data: ContactArchivedPayload
}
export interface ContactLinkedEvent extends EventBase<'contact.linked'> {
  data: ContactLinkedPayload
}
export interface ContactUnlinkedEvent extends EventBase<'contact.unlinked'> {
  data: ContactUnlinkedPayload
}
export interface OrganizationCreatedEvent extends EventBase<'organization.created'> {
  data: OrganizationCreatedPayload
}
export interface OrganizationUpdatedEvent extends EventBase<'organization.updated'> {
  data: OrganizationUpdatedPayload
}
export interface OrganizationArchivedEvent extends EventBase<'organization.archived'> {
  data: OrganizationArchivedPayload
}
export interface OrganizationUnarchivedEvent extends EventBase<'organization.unarchived'> {
  data: OrganizationUnarchivedPayload
}

// ============================================================================
// Help Center events (Phase 2) — categories and articles
// ============================================================================

/**
 * Snapshot of a help-center category embedded in `help_center.category.*`
 * events. Lean shape — ids + key display/visibility fields. Receivers can
 * hydrate richer data (counts, audience lists) via REST GET.
 */
export interface EventHelpCenterCategoryRef {
  id: string
  slug: string
  name: string
  parentId: string | null
  isPublic: boolean
  visibility: string | null
  position: number
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Snapshot of a help-center article embedded in `help_center.article.*`
 * events. Omits the rendered body — receivers can hydrate via REST GET.
 */
export interface EventHelpCenterArticleRef {
  id: string
  categoryId: string
  slug: string
  title: string
  authorPrincipalId: string | null
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface HelpCenterCategoryCreatedPayload {
  category: EventHelpCenterCategoryRef
}
export interface HelpCenterCategoryUpdatedPayload {
  category: EventHelpCenterCategoryRef
  changedFields: string[]
}
export interface HelpCenterCategoryDeletedPayload {
  category: EventHelpCenterCategoryRef
}
export interface HelpCenterArticleCreatedPayload {
  article: EventHelpCenterArticleRef
}
export interface HelpCenterArticleUpdatedPayload {
  article: EventHelpCenterArticleRef
  changedFields: string[]
}
export interface HelpCenterArticlePublishedPayload {
  article: EventHelpCenterArticleRef
}
export interface HelpCenterArticleUnpublishedPayload {
  article: EventHelpCenterArticleRef
}
export interface HelpCenterArticleDeletedPayload {
  article: EventHelpCenterArticleRef
}

export interface HelpCenterCategoryCreatedEvent extends EventBase<'help_center.category.created'> {
  data: HelpCenterCategoryCreatedPayload
}
export interface HelpCenterCategoryUpdatedEvent extends EventBase<'help_center.category.updated'> {
  data: HelpCenterCategoryUpdatedPayload
}
export interface HelpCenterCategoryDeletedEvent extends EventBase<'help_center.category.deleted'> {
  data: HelpCenterCategoryDeletedPayload
}
export interface HelpCenterArticleCreatedEvent extends EventBase<'help_center.article.created'> {
  data: HelpCenterArticleCreatedPayload
}
export interface HelpCenterArticleUpdatedEvent extends EventBase<'help_center.article.updated'> {
  data: HelpCenterArticleUpdatedPayload
}
export interface HelpCenterArticlePublishedEvent extends EventBase<'help_center.article.published'> {
  data: HelpCenterArticlePublishedPayload
}
export interface HelpCenterArticleUnpublishedEvent extends EventBase<'help_center.article.unpublished'> {
  data: HelpCenterArticleUnpublishedPayload
}
export interface HelpCenterArticleDeletedEvent extends EventBase<'help_center.article.deleted'> {
  data: HelpCenterArticleDeletedPayload
}

// ============================================================================
// Changelog events (Phase 2) — entry CRUD ('changelog.published' is separate)
// ============================================================================

/** Snapshot of a changelog entry embedded in `changelog.*` CRUD events. */
export interface EventChangelogRef {
  id: string
  title: string
  contentPreview: string
  categoryId: string | null
  productId: string | null
  publishedAt: string | null
  linkedPostCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface ChangelogCreatedPayload {
  changelog: EventChangelogRef
}
export interface ChangelogUpdatedPayload {
  changelog: EventChangelogRef
  changedFields: string[]
}
export interface ChangelogDeletedPayload {
  changelog: EventChangelogRef
}

export interface ChangelogCreatedEvent extends EventBase<'changelog.created'> {
  data: ChangelogCreatedPayload
}
export interface ChangelogUpdatedEvent extends EventBase<'changelog.updated'> {
  data: ChangelogUpdatedPayload
}
export interface ChangelogDeletedEvent extends EventBase<'changelog.deleted'> {
  data: ChangelogDeletedPayload
}

// ============================================================================
// Audience events (Phase 2) — segments and user-attribute definitions
// ============================================================================

/** Snapshot of a segment embedded in `segment.*` events. */
export interface EventSegmentRef {
  id: string
  slug: string
  name: string
  type: string
  color: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** Snapshot of a user-attribute definition embedded in `user_attribute.*` events. */
export interface EventUserAttributeRef {
  id: string
  key: string
  label: string
  type: string
  currencyCode: string | null
  externalKey: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface SegmentCreatedPayload {
  segment: EventSegmentRef
}
export interface SegmentUpdatedPayload {
  segment: EventSegmentRef
  changedFields: string[]
}
export interface SegmentDeletedPayload {
  segment: EventSegmentRef
}
export interface UserAttributeCreatedPayload {
  attribute: EventUserAttributeRef
}
export interface UserAttributeUpdatedPayload {
  attribute: EventUserAttributeRef
  changedFields: string[]
}
export interface UserAttributeDeletedPayload {
  attribute: EventUserAttributeRef
}

export interface SegmentCreatedEvent extends EventBase<'segment.created'> {
  data: SegmentCreatedPayload
}
export interface SegmentUpdatedEvent extends EventBase<'segment.updated'> {
  data: SegmentUpdatedPayload
}
export interface SegmentDeletedEvent extends EventBase<'segment.deleted'> {
  data: SegmentDeletedPayload
}
export interface UserAttributeCreatedEvent extends EventBase<'user_attribute.created'> {
  data: UserAttributeCreatedPayload
}
export interface UserAttributeUpdatedEvent extends EventBase<'user_attribute.updated'> {
  data: UserAttributeUpdatedPayload
}
export interface UserAttributeDeletedEvent extends EventBase<'user_attribute.deleted'> {
  data: UserAttributeDeletedPayload
}

// ============================================================================
// Feedback configuration events (Phase 8) — boards, tags, statuses, roadmaps
// ============================================================================

/** Snapshot of a feedback board embedded in `board.*` events. */
export interface EventBoardRef {
  id: string
  slug: string
  name: string
  description: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** Snapshot of a tag embedded in `tag.*` events. */
export interface EventTagRef {
  id: string
  name: string
  color: string | null
  description: string | null
  createdAt: string | null
}

/** Snapshot of a post status embedded in `status.*` events. */
export interface EventStatusRef {
  id: string
  slug: string
  name: string
  color: string | null
  category: string
  position: number
  showOnRoadmap: boolean
  isDefault: boolean
  createdAt: string | null
}

/** Snapshot of a roadmap embedded in `roadmap.*` events. */
export interface EventRoadmapRef {
  id: string
  slug: string
  name: string
  description: string | null
  isPublic: boolean
  position: number
  createdAt: string | null
  updatedAt: string | null
}

export interface BoardCreatedPayload {
  board: EventBoardRef
}
export interface BoardUpdatedPayload {
  board: EventBoardRef
  changedFields: string[]
}
export interface BoardDeletedPayload {
  board: EventBoardRef
}
export interface TagCreatedPayload {
  tag: EventTagRef
}
export interface TagUpdatedPayload {
  tag: EventTagRef
  changedFields: string[]
}
export interface TagDeletedPayload {
  tag: EventTagRef
}
export interface StatusCreatedPayload {
  status: EventStatusRef
}
export interface StatusUpdatedPayload {
  status: EventStatusRef
  changedFields: string[]
}
export interface StatusDeletedPayload {
  status: EventStatusRef
}
export interface RoadmapCreatedPayload {
  roadmap: EventRoadmapRef
}
export interface RoadmapUpdatedPayload {
  roadmap: EventRoadmapRef
  changedFields: string[]
}
export interface RoadmapDeletedPayload {
  roadmap: EventRoadmapRef
}

export interface BoardCreatedEvent extends EventBase<'board.created'> {
  data: BoardCreatedPayload
}
export interface BoardUpdatedEvent extends EventBase<'board.updated'> {
  data: BoardUpdatedPayload
}
export interface BoardDeletedEvent extends EventBase<'board.deleted'> {
  data: BoardDeletedPayload
}
export interface TagCreatedEvent extends EventBase<'tag.created'> {
  data: TagCreatedPayload
}
export interface TagUpdatedEvent extends EventBase<'tag.updated'> {
  data: TagUpdatedPayload
}
export interface TagDeletedEvent extends EventBase<'tag.deleted'> {
  data: TagDeletedPayload
}
export interface StatusCreatedEvent extends EventBase<'status.created'> {
  data: StatusCreatedPayload
}
export interface StatusUpdatedEvent extends EventBase<'status.updated'> {
  data: StatusUpdatedPayload
}
export interface StatusDeletedEvent extends EventBase<'status.deleted'> {
  data: StatusDeletedPayload
}
export interface RoadmapCreatedEvent extends EventBase<'roadmap.created'> {
  data: RoadmapCreatedPayload
}
export interface RoadmapUpdatedEvent extends EventBase<'roadmap.updated'> {
  data: RoadmapUpdatedPayload
}
export interface RoadmapDeletedEvent extends EventBase<'roadmap.deleted'> {
  data: RoadmapDeletedPayload
}

// ============================================================================
// Support configuration events (Phase 8) — SLA, routing, business hours,
// inbox channels, inbox memberships
// ============================================================================

/** Snapshot of an SLA policy embedded in `sla_policy.*` events. */
export interface EventSlaPolicyRef {
  id: string
  name: string
  scope: string
  enabled: boolean
  priority: number
  archivedAt: string | null
}

/** Snapshot of a routing rule embedded in `routing_rule.*` events. */
export interface EventRoutingRuleRef {
  id: string
  name: string
  enabled: boolean
  priority: number
  inboxIdScope: string | null
}

/** Snapshot of a business-hours calendar embedded in `business_hours.*` events. */
export interface EventBusinessHoursRef {
  id: string
  name: string
  timezone: string
  archivedAt: string | null
}

/** Snapshot of an inbox channel embedded in `inbox_channel.*` events. `config` is intentionally omitted (opaque, may carry secrets). */
export interface EventInboxChannelRef {
  id: string
  inboxId: string
  kind: string
  label: string
  externalId: string | null
  enabled: boolean
  archivedAt: string | null
}

/** Snapshot of an inbox membership embedded in `inbox_membership.*` events. */
export interface EventInboxMembershipRef {
  id: string
  inboxId: string
  principalId: string
  role: string
}

export interface SlaPolicyCreatedPayload {
  policy: EventSlaPolicyRef
}
export interface SlaPolicyUpdatedPayload {
  policy: EventSlaPolicyRef
  changedFields: string[]
}
export interface SlaPolicyArchivedPayload {
  policy: EventSlaPolicyRef
}
export interface RoutingRuleCreatedPayload {
  rule: EventRoutingRuleRef
}
export interface RoutingRuleUpdatedPayload {
  rule: EventRoutingRuleRef
  changedFields: string[]
}
export interface RoutingRuleDeletedPayload {
  rule: EventRoutingRuleRef
}
export interface BusinessHoursCreatedPayload {
  businessHours: EventBusinessHoursRef
}
export interface BusinessHoursUpdatedPayload {
  businessHours: EventBusinessHoursRef
  changedFields: string[]
}
export interface BusinessHoursArchivedPayload {
  businessHours: EventBusinessHoursRef
}
export interface InboxChannelCreatedPayload {
  channel: EventInboxChannelRef
}
export interface InboxChannelUpdatedPayload {
  channel: EventInboxChannelRef
  changedFields: string[]
}
export interface InboxChannelArchivedPayload {
  channel: EventInboxChannelRef
}
export interface InboxMembershipAddedPayload {
  membership: EventInboxMembershipRef
}
export interface InboxMembershipUpdatedPayload {
  membership: EventInboxMembershipRef
  previousRole: string | null
}
export interface InboxMembershipRemovedPayload {
  membership: EventInboxMembershipRef
}

export interface SlaPolicyCreatedEvent extends EventBase<'sla_policy.created'> {
  data: SlaPolicyCreatedPayload
}
export interface SlaPolicyUpdatedEvent extends EventBase<'sla_policy.updated'> {
  data: SlaPolicyUpdatedPayload
}
export interface SlaPolicyArchivedEvent extends EventBase<'sla_policy.archived'> {
  data: SlaPolicyArchivedPayload
}
export interface RoutingRuleCreatedEvent extends EventBase<'routing_rule.created'> {
  data: RoutingRuleCreatedPayload
}
export interface RoutingRuleUpdatedEvent extends EventBase<'routing_rule.updated'> {
  data: RoutingRuleUpdatedPayload
}
export interface RoutingRuleDeletedEvent extends EventBase<'routing_rule.deleted'> {
  data: RoutingRuleDeletedPayload
}
export interface BusinessHoursCreatedEvent extends EventBase<'business_hours.created'> {
  data: BusinessHoursCreatedPayload
}
export interface BusinessHoursUpdatedEvent extends EventBase<'business_hours.updated'> {
  data: BusinessHoursUpdatedPayload
}
export interface BusinessHoursArchivedEvent extends EventBase<'business_hours.archived'> {
  data: BusinessHoursArchivedPayload
}
export interface InboxChannelCreatedEvent extends EventBase<'inbox_channel.created'> {
  data: InboxChannelCreatedPayload
}
export interface InboxChannelUpdatedEvent extends EventBase<'inbox_channel.updated'> {
  data: InboxChannelUpdatedPayload
}
export interface InboxChannelArchivedEvent extends EventBase<'inbox_channel.archived'> {
  data: InboxChannelArchivedPayload
}
export interface InboxMembershipAddedEvent extends EventBase<'inbox_membership.added'> {
  data: InboxMembershipAddedPayload
}
export interface InboxMembershipUpdatedEvent extends EventBase<'inbox_membership.updated'> {
  data: InboxMembershipUpdatedPayload
}
export interface InboxMembershipRemovedEvent extends EventBase<'inbox_membership.removed'> {
  data: InboxMembershipRemovedPayload
}

// ============================================================================
// Administration / security events (Phase 8) — API keys, roles, assignments
// ============================================================================

/**
 * Snapshot of an API key embedded in `api_key.*` events.
 *
 * SECURITY: the plaintext key, key hash, and key prefix MUST NEVER appear in
 * the event payload. Only id + name + scopes (capabilities) are exposed.
 */
export interface EventApiKeyRef {
  id: string
  name: string
  scopes: string[]
}

/** Snapshot of a role embedded in `role.*` events. */
export interface EventRoleRef {
  id: string
  key: string
  name: string
  isSystem: boolean
}

/** Snapshot of a role assignment embedded in `role_assignment.*` events. */
export interface EventRoleAssignmentRef {
  id: string
  roleId: string
  roleKey: string
  principalId: string
  teamId: string | null
}

export interface ApiKeyCreatedPayload {
  apiKey: EventApiKeyRef
}
export interface ApiKeyRotatedPayload {
  apiKey: EventApiKeyRef
}
export interface ApiKeyRevokedPayload {
  apiKey: EventApiKeyRef
}
export interface RoleCreatedPayload {
  role: EventRoleRef
}
export interface RoleUpdatedPayload {
  role: EventRoleRef
  changedFields: string[]
}
export interface RoleDeletedPayload {
  role: EventRoleRef
}
export interface RoleAssignmentCreatedPayload {
  assignment: EventRoleAssignmentRef
}
export interface RoleAssignmentRevokedPayload {
  assignment: EventRoleAssignmentRef
}

export interface ApiKeyCreatedEvent extends EventBase<'api_key.created'> {
  data: ApiKeyCreatedPayload
}
export interface ApiKeyRotatedEvent extends EventBase<'api_key.rotated'> {
  data: ApiKeyRotatedPayload
}
export interface ApiKeyRevokedEvent extends EventBase<'api_key.revoked'> {
  data: ApiKeyRevokedPayload
}
export interface RoleCreatedEvent extends EventBase<'role.created'> {
  data: RoleCreatedPayload
}
export interface RoleUpdatedEvent extends EventBase<'role.updated'> {
  data: RoleUpdatedPayload
}
export interface RoleDeletedEvent extends EventBase<'role.deleted'> {
  data: RoleDeletedPayload
}
export interface RoleAssignmentCreatedEvent extends EventBase<'role_assignment.created'> {
  data: RoleAssignmentCreatedPayload
}
export interface RoleAssignmentRevokedEvent extends EventBase<'role_assignment.revoked'> {
  data: RoleAssignmentRevokedPayload
}
