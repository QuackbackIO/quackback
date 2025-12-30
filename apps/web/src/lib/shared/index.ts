/**
 * Shared domain types and utilities
 */

export type { PaginationParams, PaginatedResult } from './pagination'

export type { Result, DomainError } from './result'

export { ok, err, isOk, isErr, unwrap, unwrapOr, map, mapErr, flatMap } from './result'

// Comment tree utilities (used by PostService and CommentService)
export {
  buildCommentTree,
  aggregateReactions,
  type CommentWithReactions,
  type CommentTreeNode,
  type CommentReactionCount,
} from './comment-tree'
