import type { IntegrationId, EventMappingId } from '@quackback/ids'

/**
 * Supported event types
 */
export type EventType = 'post.created' | 'post.status_changed' | 'comment.created'

/**
 * Actor information for events.
 * Identifies who or what triggered the event.
 */
export interface EventActor {
  /** Whether this is a user action or system-triggered */
  type: 'user' | 'system'
  /** User ID if triggered by a user */
  userId?: string
  /** Email of the user who triggered the event */
  email?: string
  /** Service name if triggered by system (e.g., 'import-processor') */
  service?: string
}

// ============================================================================
// Event Payload Types
// ============================================================================

/**
 * Post data included in post-related events
 */
export interface EventPostData {
  /** Post ID */
  id: string
  /** Post title */
  title: string
  /** Post content (HTML) */
  content: string
  /** Board ID the post belongs to */
  boardId: string
  /** Board slug for URL generation */
  boardSlug: string
  /** Email of the post author */
  authorEmail?: string
  /** Current vote count */
  voteCount: number
}

/**
 * Minimal post reference used in status change and comment events
 */
export interface EventPostRef {
  /** Post ID */
  id: string
  /** Post title */
  title: string
  /** Board slug for URL generation */
  boardSlug: string
}

/**
 * Comment data included in comment.created events
 */
export interface EventCommentData {
  /** Comment ID */
  id: string
  /** Comment content (HTML) */
  content: string
  /** Email of the comment author */
  authorEmail?: string
}

/**
 * Payload for post.created events
 */
export interface PostCreatedPayload {
  /** The created post */
  post: EventPostData
}

/**
 * Payload for post.status_changed events
 */
export interface PostStatusChangedPayload {
  /** The post that was updated */
  post: EventPostRef
  /** Status before the change (e.g., "Open") */
  previousStatus: string
  /** Status after the change (e.g., "In Progress") */
  newStatus: string
}

/**
 * Payload for comment.created events
 */
export interface CommentCreatedPayload {
  /** The created comment */
  comment: EventCommentData
  /** The post the comment was added to */
  post: Omit<EventPostRef, 'boardSlug'>
}

/**
 * Maps event types to their payload types
 */
export interface EventPayloadMap {
  'post.created': PostCreatedPayload
  'post.status_changed': PostStatusChangedPayload
  'comment.created': CommentCreatedPayload
}

// ============================================================================
// Event Data (Discriminated Union)
// ============================================================================

/**
 * Base fields shared by all events
 */
interface EventDataBase<T extends EventType> {
  /** Unique event ID for idempotency */
  id: string
  /** Event type */
  type: T
  /** ISO timestamp of when the event occurred */
  timestamp: string
  /** Actor who triggered the event */
  actor: EventActor
}

/**
 * Event data for post.created events
 */
export interface PostCreatedEvent extends EventDataBase<'post.created'> {
  data: PostCreatedPayload
}

/**
 * Event data for post.status_changed events
 */
export interface PostStatusChangedEvent extends EventDataBase<'post.status_changed'> {
  data: PostStatusChangedPayload
}

/**
 * Event data for comment.created events
 */
export interface CommentCreatedEvent extends EventDataBase<'comment.created'> {
  data: CommentCreatedPayload
}

/**
 * Event data - discriminated union of all event types.
 *
 * Use type narrowing to access event-specific data:
 * @example
 * if (event.type === 'post.created') {
 *   // event.data is PostCreatedPayload
 *   console.log(event.data.post.title)
 * }
 */
export type EventData = PostCreatedEvent | PostStatusChangedEvent | CommentCreatedEvent

/**
 * Helper type to extract the payload type for a given event type
 */
export type EventPayloadFor<T extends EventType> = EventPayloadMap[T]

/**
 * Helper type to extract the full event data for a given event type
 */
export type EventDataFor<T extends EventType> = Extract<EventData, { type: T }>

/**
 * Event processing result
 */
export interface EventResult {
  /** Number of integrations successfully processed */
  integrationsProcessed: number
  /** Errors from integration processing */
  integrationErrors: string[]
  /** Number of notification emails sent */
  notificationsSent: number
  /** Errors from notification sending */
  notificationErrors: string[]
}

// ============================================================================
// Integration Types
// ============================================================================

/**
 * Domain event structure passed to integrations
 */
export interface DomainEventPayload {
  id: string
  type: string
  timestamp: string
  actor: { type: 'user' | 'system'; userId?: string; email?: string; service?: string }
  data: unknown
}

/**
 * Integration processing data
 */
export interface IntegrationData {
  /** Integration configuration ID */
  integrationId: IntegrationId
  /** Integration type (slack, discord, linear, etc.) */
  integrationType: string
  /** Event mapping ID */
  mappingId: EventMappingId
  /** The domain event that triggered this */
  event: DomainEventPayload
}

/**
 * Integration processing result
 */
export interface IntegrationResult {
  /** Whether the integration action succeeded */
  success: boolean
  /** External entity ID (e.g., Slack message ts, Linear issue ID) */
  externalEntityId?: string
  /** Error message if failed */
  error?: string
  /** Processing duration in milliseconds */
  durationMs: number
}

/**
 * User notification data
 */
export interface UserNotificationData {
  /** Event ID for idempotency */
  eventId: string
  /** Event type (post.status_changed, comment.created) */
  eventType: string
  /** Event timestamp */
  timestamp: string
  /** Actor who triggered the event (excluded from notifications) */
  actor: { type: 'user' | 'system'; userId?: string; email?: string }
  /** Event-specific data */
  data: unknown
}

/**
 * User notification result
 */
export interface UserNotificationResult {
  /** Number of emails sent */
  emailsSent: number
  /** Number of subscribers skipped (due to preferences or being the actor) */
  skipped: number
  /** Errors encountered */
  errors: string[]
}
