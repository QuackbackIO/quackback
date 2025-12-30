import type { DomainError } from '@/lib/shared'

/**
 * Error codes specific to Post domain operations
 */
export type PostErrorCode =
  | 'POST_NOT_FOUND'
  | 'BOARD_NOT_FOUND'
  | 'STATUS_NOT_FOUND'
  | 'INVALID_TAGS'
  | 'UNAUTHORIZED'
  | 'ALREADY_VOTED'
  | 'VALIDATION_ERROR'
  | 'EDIT_NOT_ALLOWED'
  | 'DELETE_NOT_ALLOWED'
  | 'ALREADY_DELETED'

/**
 * Domain error type for Post operations
 */
export interface PostError extends DomainError {
  code: PostErrorCode
}

/**
 * Factory functions for creating PostError instances
 */
export const PostError = {
  notFound: (id?: string): PostError => ({
    code: 'POST_NOT_FOUND',
    message: id ? `Post with ID ${id} not found` : 'Post not found',
  }),

  boardNotFound: (id?: string): PostError => ({
    code: 'BOARD_NOT_FOUND',
    message: id ? `Board with ID ${id} not found` : 'Board not found',
  }),

  statusNotFound: (id?: string): PostError => ({
    code: 'STATUS_NOT_FOUND',
    message: id ? `Status with ID ${id} not found` : 'Status not found',
  }),

  invalidTags: (): PostError => ({
    code: 'INVALID_TAGS',
    message: 'Invalid tags provided',
  }),

  unauthorized: (action?: string): PostError => ({
    code: 'UNAUTHORIZED',
    message: action ? `Unauthorized to ${action}` : 'Unauthorized to perform this action',
  }),

  alreadyVoted: (): PostError => ({
    code: 'ALREADY_VOTED',
    message: 'User has already voted on this post',
  }),

  validationError: (message: string): PostError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),

  editNotAllowed: (reason: string): PostError => ({
    code: 'EDIT_NOT_ALLOWED',
    message: reason,
  }),

  deleteNotAllowed: (reason: string): PostError => ({
    code: 'DELETE_NOT_ALLOWED',
    message: reason,
  }),

  alreadyDeleted: (id?: string): PostError => ({
    code: 'ALREADY_DELETED',
    message: id ? `Post with ID ${id} has already been deleted` : 'Post has already been deleted',
  }),
}
