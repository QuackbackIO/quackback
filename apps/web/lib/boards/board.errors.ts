import type { DomainError } from '@/lib/shared'

/**
 * Error codes specific to Board domain operations
 */
export type BoardErrorCode =
  | 'BOARD_NOT_FOUND'
  | 'DUPLICATE_SLUG'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'

/**
 * Domain error type for Board operations
 */
export interface BoardError extends DomainError {
  code: BoardErrorCode
}

/**
 * Factory functions for creating BoardError instances
 */
export const BoardError = {
  notFound: (id?: string): BoardError => ({
    code: 'BOARD_NOT_FOUND',
    message: id ? `Board with ID ${id} not found` : 'Board not found',
  }),

  duplicateSlug: (slug: string): BoardError => ({
    code: 'DUPLICATE_SLUG',
    message: `A board with slug "${slug}" already exists`,
  }),

  unauthorized: (action?: string): BoardError => ({
    code: 'UNAUTHORIZED',
    message: action ? `Unauthorized to ${action}` : 'Unauthorized to perform this action',
  }),

  validationError: (message: string): BoardError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),
}
