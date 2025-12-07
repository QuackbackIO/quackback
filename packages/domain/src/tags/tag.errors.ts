import type { DomainError } from '../shared/result'

/**
 * Error codes specific to Tag domain operations
 */
export type TagErrorCode = 'TAG_NOT_FOUND' | 'DUPLICATE_NAME' | 'UNAUTHORIZED' | 'VALIDATION_ERROR'

/**
 * Domain error type for Tag operations
 */
export interface TagError extends DomainError {
  code: TagErrorCode
}

/**
 * Factory functions for creating TagError instances
 */
export const TagError = {
  notFound: (id?: string): TagError => ({
    code: 'TAG_NOT_FOUND',
    message: id ? `Tag with ID ${id} not found` : 'Tag not found',
  }),

  duplicateName: (name: string): TagError => ({
    code: 'DUPLICATE_NAME',
    message: `A tag with name "${name}" already exists`,
  }),

  unauthorized: (action?: string): TagError => ({
    code: 'UNAUTHORIZED',
    message: action ? `Unauthorized to ${action}` : 'Unauthorized to perform this action',
  }),

  validationError: (message: string): TagError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),
}
