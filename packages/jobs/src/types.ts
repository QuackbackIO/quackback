/**
 * Job type identifiers
 */
export const JobTypes = {
  IMPORT_POSTS: 'import-posts',
} as const

export type JobType = (typeof JobTypes)[keyof typeof JobTypes]

/**
 * Import job data - sent when creating a new import job
 */
export interface ImportJobData {
  /** Organization ID for tenant isolation */
  organizationId: string
  /** Target board ID for imported posts */
  boardId: string
  /** CSV content encoded as base64 */
  csvContent: string
  /** Total number of rows in the CSV (excluding header) */
  totalRows: number
  /** Member ID of the user who initiated the import */
  initiatedByMemberId: string
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
