import type { WorkspaceId, BoardId, MemberId, IntegrationId, EventMappingId } from '@quackback/ids'

/**
 * Job type identifiers
 */
export const JobTypes = {
  IMPORT_POSTS: 'import-posts',
  INTEGRATION: 'integration',
} as const

export type JobType = (typeof JobTypes)[keyof typeof JobTypes]

/**
 * Import job data - sent when creating a new import job
 */
export interface ImportJobData {
  /** Organization ID for tenant isolation */
  workspaceId: WorkspaceId
  /** Target board ID for imported posts */
  boardId: BoardId
  /** CSV content encoded as base64 */
  csvContent: string
  /** Total number of rows in the CSV (excluding header) */
  totalRows: number
  /** Member ID of the user who initiated the import */
  initiatedByMemberId: MemberId
}

/**
 * Import job progress - reported during processing
 */
export interface ImportJobProgress {
  /** Number of rows processed so far */
  processed: number
  /** Total number of rows to process */
  total: number
}

/**
 * Import error details for a single row
 */
export interface ImportRowError {
  /** Row number (1-indexed, excluding header) */
  row: number
  /** Error message describing what went wrong */
  message: string
  /** Optional field name that caused the error */
  field?: string
}

/**
 * Import job result - returned when job completes
 */
export interface ImportJobResult {
  /** Number of posts successfully imported */
  imported: number
  /** Number of rows skipped due to errors */
  skipped: number
  /** List of errors encountered during import */
  errors: ImportRowError[]
  /** List of tag names that were auto-created */
  createdTags: string[]
}

/**
 * Job status response for API polling
 */
export interface ImportJobStatus {
  /** Job ID */
  jobId: string
  /** Current job state */
  status: 'waiting' | 'active' | 'completed' | 'failed'
  /** Progress information (if active) */
  progress?: ImportJobProgress
  /** Result (if completed) */
  result?: ImportJobResult
  /** Error message (if failed) */
  error?: string
}

// ============================================================================
// Integration Job Types
// ============================================================================

/**
 * Domain event structure passed to integration jobs
 */
export interface DomainEventPayload {
  id: string
  type: string
  workspaceId: WorkspaceId
  timestamp: string
  actor: { type: 'user' | 'system'; userId?: string; email?: string; service?: string }
  data: unknown
}

/**
 * Integration job data - sent when a domain event triggers an integration
 */
export interface IntegrationJobData {
  /** Organization ID for tenant isolation */
  workspaceId: WorkspaceId
  /** Integration configuration ID */
  integrationId: IntegrationId
  /** Integration type (slack, discord, linear, etc.) */
  integrationType: string
  /** Event mapping ID */
  mappingId: EventMappingId
  /** The domain event that triggered this job */
  event: DomainEventPayload
}

/**
 * Integration job result - returned when job completes
 */
export interface IntegrationJobResult {
  /** Whether the integration action succeeded */
  success: boolean
  /** External entity ID (e.g., Slack message ts, Linear issue ID) */
  externalEntityId?: string
  /** Error message if failed */
  error?: string
  /** Processing duration in milliseconds */
  durationMs: number
}

// ============================================================================
// User Notification Job Types
// ============================================================================

/**
 * User notification job data - sent when a domain event should notify subscribers
 */
export interface UserNotificationJobData {
  /** Event ID for idempotency */
  eventId: string
  /** Event type (post.status_changed, comment.created) */
  eventType: string
  /** Organization ID for tenant isolation */
  workspaceId: WorkspaceId
  /** Event timestamp */
  timestamp: string
  /** Actor who triggered the event (excluded from notifications) */
  actor: { type: 'user' | 'system'; userId?: string; email?: string }
  /** Event-specific data */
  data: unknown
}

/**
 * User notification job result - returned when job completes
 */
export interface UserNotificationJobResult {
  /** Number of emails sent */
  emailsSent: number
  /** Number of subscribers skipped (due to preferences or being the actor) */
  skipped: number
  /** Errors encountered */
  errors: string[]
}

// ============================================================================
// Event Job Types (Consolidated workflow for integrations + notifications)
// ============================================================================

/**
 * Supported event types for the consolidated EventWorkflow
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
// Event Job Data (Discriminated Union)
// ============================================================================

/**
 * Base fields shared by all event job data
 */
interface EventJobDataBase<T extends EventType> {
  /** Unique event ID for idempotency */
  id: string
  /** Event type */
  type: T
  /** Organization ID for tenant isolation */
  workspaceId: WorkspaceId
  /** ISO timestamp of when the event occurred */
  timestamp: string
  /** Actor who triggered the event */
  actor: EventActor
}

/**
 * Event job data for post.created events
 */
export interface PostCreatedEventJobData extends EventJobDataBase<'post.created'> {
  data: PostCreatedPayload
}

/**
 * Event job data for post.status_changed events
 */
export interface PostStatusChangedEventJobData extends EventJobDataBase<'post.status_changed'> {
  data: PostStatusChangedPayload
}

/**
 * Event job data for comment.created events
 */
export interface CommentCreatedEventJobData extends EventJobDataBase<'comment.created'> {
  data: CommentCreatedPayload
}

/**
 * Event job data - discriminated union of all event types.
 * Consolidates integration and notification processing into a single workflow.
 *
 * Use type narrowing to access event-specific data:
 * @example
 * if (event.type === 'post.created') {
 *   // event.data is PostCreatedPayload
 *   console.log(event.data.post.title)
 * }
 */
export type EventJobData =
  | PostCreatedEventJobData
  | PostStatusChangedEventJobData
  | CommentCreatedEventJobData

/**
 * Helper type to extract the payload type for a given event type
 */
export type EventPayloadFor<T extends EventType> = EventPayloadMap[T]

/**
 * Helper type to extract the full event job data for a given event type
 */
export type EventJobDataFor<T extends EventType> = Extract<EventJobData, { type: T }>

/**
 * Event job result - returned when workflow completes
 */
export interface EventJobResult {
  /** Number of integrations successfully processed */
  integrationsProcessed: number
  /** Errors from integration processing */
  integrationErrors: string[]
  /** Number of notification emails sent */
  notificationsSent: number
  /** Errors from notification sending */
  notificationErrors: string[]
}
