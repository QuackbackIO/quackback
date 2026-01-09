/**
 * Intermediate format types for data import
 *
 * These types represent the standardized format that all source adapters
 * must convert to before the core importer processes them.
 */

/**
 * Moderation state for imported posts
 * - published: Normal visible post
 * - pending: Awaiting moderation
 * - spam: Marked as spam
 * - archived: Hidden from public view
 */
export type ModerationState = 'published' | 'pending' | 'spam' | 'archived'

/**
 * Intermediate post format
 * All fields except id, title, and body are optional
 */
export interface IntermediatePost {
  /** External ID from source system (used for linking comments/votes) */
  id: string
  /** Post title */
  title: string
  /** Post body/description (plain text or HTML) */
  body: string
  /** Author email address */
  authorEmail?: string
  /** Author display name */
  authorName?: string
  /** Target board slug */
  board?: string
  /** Status slug (e.g., 'open', 'planned', 'in_progress', 'complete', 'closed') */
  status?: string
  /** Moderation state (defaults to 'published' if not provided) */
  moderation: ModerationState
  /** Comma-separated tag names */
  tags?: string
  /** Roadmap slug (for roadmap assignment) */
  roadmap?: string
  /** Fallback vote count (used if individual votes not available) */
  voteCount?: number
  /** Creation timestamp (ISO 8601) */
  createdAt?: string
  /** Official response text */
  response?: string
  /** Official response timestamp (ISO 8601) */
  responseAt?: string
  /** Official response author email */
  responseBy?: string
}

/**
 * Intermediate comment format
 */
export interface IntermediateComment {
  /** External post ID this comment belongs to */
  postId: string
  /** Comment author email */
  authorEmail?: string
  /** Comment author display name */
  authorName?: string
  /** Comment text content */
  body: string
  /** Whether the author is a staff/team member (defaults to false if not provided) */
  isStaff: boolean
  /** Creation timestamp (ISO 8601) */
  createdAt?: string
}

/**
 * Intermediate vote format
 */
export interface IntermediateVote {
  /** External post ID this vote belongs to */
  postId: string
  /** Voter email address */
  voterEmail: string
  /** Vote timestamp (ISO 8601) */
  createdAt?: string
}

/**
 * Intermediate internal note format (staff-only notes)
 */
export interface IntermediateNote {
  /** External post ID this note belongs to */
  postId: string
  /** Note author email */
  authorEmail?: string
  /** Note author display name */
  authorName?: string
  /** Note text content */
  body: string
  /** Creation timestamp (ISO 8601) */
  createdAt?: string
}

/**
 * Complete intermediate dataset for import
 */
export interface IntermediateData {
  posts: IntermediatePost[]
  comments: IntermediateComment[]
  votes: IntermediateVote[]
  notes: IntermediateNote[]
}

/**
 * Import options
 */
export interface ImportOptions {
  /** Target board slug (required) */
  board: string
  /** Auto-create missing tags */
  createTags?: boolean
  /** Create members for unknown emails */
  createUsers?: boolean
  /** Validate only, don't insert */
  dryRun?: boolean
  /** Verbose output */
  verbose?: boolean
  /** Batch size for database operations */
  batchSize?: number
}

/**
 * Import result statistics
 */
export interface ImportResult {
  posts: { imported: number; skipped: number; errors: number }
  comments: { imported: number; skipped: number; errors: number }
  votes: { imported: number; skipped: number; errors: number }
  notes: { imported: number; skipped: number; errors: number }
  duration: number
  errors: ImportError[]
}

/**
 * Import error details
 */
export interface ImportError {
  type: 'post' | 'comment' | 'vote' | 'note'
  externalId: string
  message: string
  row?: number
}
