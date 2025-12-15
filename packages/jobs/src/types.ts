import type { OrgId, BoardId, MemberId } from '@quackback/ids'

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
  organizationId: OrgId
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
  organizationId: OrgId
  timestamp: string
  actor: { type: 'user' | 'system'; userId?: string; email?: string; service?: string }
  data: unknown
}

/**
 * Integration job data - sent when a domain event triggers an integration
 */
export interface IntegrationJobData {
  /** Organization ID for tenant isolation */
  organizationId: OrgId
  /** Integration configuration ID */
  integrationId: string
  /** Integration type (slack, discord, linear, etc.) */
  integrationType: string
  /** Event mapping ID */
  mappingId: string
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
  organizationId: OrgId
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
