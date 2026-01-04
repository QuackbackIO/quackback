/**
 * Shared domain types and utilities
 */

export type { PaginationParams, PaginatedResult } from './pagination'

// Domain exception classes
export {
  DomainException,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  InternalError,
} from './errors'

// Comment tree utilities (used by PostService and CommentService)
export {
  buildCommentTree,
  aggregateReactions,
  type CommentWithReactions,
  type CommentTreeNode,
  type CommentReactionCount,
} from './comment-tree'
