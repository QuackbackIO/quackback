/**
 * Shared domain types and utilities
 *
 * This directory contains code used by both client and server:
 * - types/: TypeScript type definitions
 * - schemas/: Zod validation schemas
 * - Shared utilities (pagination, errors, comment tree)
 */

// Types
export * from './types'

// Schemas
export * from './schemas'

// Pagination
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

// Role check helpers
export { isTeamMember, isAdmin } from './roles'

// Comment tree utilities (used by PostService and CommentService)
export {
  buildCommentTree,
  aggregateReactions,
  toStatusChange,
  type CommentWithReactions,
  type CommentTreeNode,
  type CommentReactionCount,
  type CommentStatusChange,
} from './comment-tree'
