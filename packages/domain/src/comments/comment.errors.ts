import type { DomainError } from '../shared/result'

/**
 * Error codes specific to Comment domain operations
 */
export type CommentErrorCode =
  | 'COMMENT_NOT_FOUND'
  | 'POST_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INVALID_PARENT'

/**
 * Domain error type for Comment operations
 */
export interface CommentError extends DomainError {
  code: CommentErrorCode
}

/**
 * Factory functions for creating CommentError instances
 */
export const CommentError = {
  notFound: (id?: string): CommentError => ({
    code: 'COMMENT_NOT_FOUND',
    message: id ? `Comment with ID ${id} not found` : 'Comment not found',
  }),

  postNotFound: (id?: string): CommentError => ({
    code: 'POST_NOT_FOUND',
    message: id ? `Post with ID ${id} not found` : 'Post not found',
  }),

  unauthorized: (action?: string): CommentError => ({
    code: 'UNAUTHORIZED',
    message: action ? `Unauthorized to ${action}` : 'Unauthorized to perform this action',
  }),

  validationError: (message: string): CommentError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),

  invalidParent: (parentId?: string): CommentError => ({
    code: 'INVALID_PARENT',
    message: parentId
      ? `Parent comment with ID ${parentId} not found or invalid`
      : 'Invalid parent comment',
  }),
}
