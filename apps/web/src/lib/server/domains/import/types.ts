import type { BoardId, PrincipalId, PostTagId } from '@quackback/ids'

/**
 * A real voter record carried alongside a source-id row (§I3). When a row's
 * source_id has an entry here, commit creates real post_votes rows for each
 * voter instead of just backfilling posts.vote_count from the CSV — the
 * honest "votes-only" fallback for sources that don't carry individual
 * voter identities.
 */
export interface ImportVoterRecord {
  email: string
  name?: string | null
  /** ISO timestamp, when the source provides one. */
  createdAt?: string
}

/**
 * CSV import input
 */
export interface ImportInput {
  /** Target board ID for imported posts */
  boardId: BoardId
  /** CSV content encoded as base64 */
  csvContent: string
  /** Total number of rows in the CSV (excluding header) */
  totalRows: number
  /** Member ID of the user who initiated the import */
  initiatedByPrincipalId: PrincipalId
  /**
   * Auto-tag applied to every post the run creates (§I1). Absent for the
   * legacy per-board synchronous path and for dry runs, which never write.
   */
  batchTagId?: PostTagId | null
  /** Real per-row voter records keyed by source_id (§I3). See ImportVoterRecord. */
  voters?: Record<string, ImportVoterRecord[]>
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
 * CSV import result
 */
export interface ImportResult {
  /** Number of posts newly created */
  imported: number
  /** Number of existing posts updated via source-id idempotence (§I2) */
  updated: number
  /** Number of rows skipped due to errors */
  skipped: number
  /** List of errors encountered during import */
  errors: ImportRowError[]
  /** List of tag names that were auto-created */
  createdTags: string[]
  /**
   * Users created with an asserted verified email (rows carrying a truthy
   * email_verified column that introduced a new author/voter). Drives the
   * per-run import.email_verified.asserted audit summary.
   */
  verifiedAuthorsCreated: number
}

/**
 * A single row in the dry-run preview's capped sample (§I2).
 */
export interface ImportPreviewRow {
  /** Row number (1-indexed, excluding header) */
  row: number
  title: string
  /** Resolved board slug, or null when the row falls back to the default board */
  board: string | null
  /** Resolved status name, or null when the row falls back to the default status */
  status: string | null
  /** Author email/name, or "Imported user" when unattributed */
  author: string
  /** True when this author does not exist yet and would be created on commit */
  isNewAuthor: boolean
  voteCount: number
  /** Whether commit would create a new post or update one matched by source_id */
  action: 'create' | 'update'
}

/**
 * Dry-run preview result (§I2): validates and resolves every row without
 * writing anything.
 */
export interface ImportPreview {
  totalRows: number
  counts: {
    byBoard: Record<string, number>
    byStatus: Record<string, number>
    byAuthor: Record<string, number>
  }
  /** Capped sample of resolved rows for display */
  sample: ImportPreviewRow[]
  /** Per-row validation errors (capped) */
  errors: ImportRowError[]
  /** Count of rows that would UPDATE an existing post via source-id match */
  updatedCount: number
}
