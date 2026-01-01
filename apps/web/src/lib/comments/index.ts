/**
 * Comment domain module exports
 *
 * IMPORTANT: This barrel export only includes types and error classes.
 * Service functions that access the database are NOT exported here to prevent
 * them from being bundled into the client.
 *
 * For service functions, import directly from './comment.service' in server-only code
 * (server functions, API routes, etc.)
 */

// Error classes (no DB dependency)
export { CommentError } from './comment.errors'
export type { CommentErrorCode } from './comment.errors'

// Types (no DB dependency)
export type {
  CreateCommentInput,
  CreateCommentResult,
  UpdateCommentInput,
  CommentThread,
  CommentReactionCount,
  ReactionResult,
  CommentContext,
} from './comment.types'
