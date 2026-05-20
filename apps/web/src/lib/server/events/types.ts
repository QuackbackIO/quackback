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

/**
 * Event data - discriminated union of all event types.
 *
 * Use type narrowing to access event-specific data:
 * @example
 * if (event.type === 'post.created') {
 *   console.log(event.data.post.title)
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
  /** Admin permalink — `${baseUrl}/admin/tickets/{id}`. */
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
    bodyTextTruncated: boolean
    authorPrincipalId: string | null
    /** True when the thread author is the ticket's requester. */
    isFromRequester: boolean
    sharedWithTeamId: string | null
    /** ISO timestamp the thread was created. */
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
