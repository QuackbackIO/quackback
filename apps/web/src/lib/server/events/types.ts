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
  'conversation.created',
  'conversation.status_changed',
  'conversation.assigned',
  'conversation.priority_changed',
  'conversation.csat_submitted',
  'conversation.csat_comment_added',
  'message.created',
  'message.note_created',
  'message.deleted',
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
  channel: 'live_chat' | 'email' | 'web_form'
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
  | ConversationCreatedEvent
  | ConversationStatusChangedEvent
  | ConversationAssignedEvent
  | ConversationPriorityChangedEvent
  | ConversationCsatSubmittedEvent
  | ConversationCsatCommentAddedEvent
  | MessageCreatedEvent
  | MessageNoteCreatedEvent
  | MessageDeletedEvent
