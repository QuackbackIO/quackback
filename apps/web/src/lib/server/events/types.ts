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
  'comment.created',
  'changelog.published',
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
}

export interface PostCreatedEvent extends EventBase<'post.created'> {
  data: PostCreatedPayload
}

export interface PostStatusChangedEvent extends EventBase<'post.status_changed'> {
  data: PostStatusChangedPayload
}

export interface CommentCreatedEvent extends EventBase<'comment.created'> {
  data: CommentCreatedPayload
}

export interface ChangelogPublishedEvent extends EventBase<'changelog.published'> {
  data: ChangelogPublishedPayload
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
  | CommentCreatedEvent
  | ChangelogPublishedEvent
