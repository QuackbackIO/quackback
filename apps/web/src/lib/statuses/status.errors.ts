import type { DomainError } from '@/lib/shared'

/**
 * Error codes specific to Status domain operations
 */
export type StatusErrorCode =
  | 'STATUS_NOT_FOUND'
  | 'DUPLICATE_SLUG'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'CANNOT_DELETE_DEFAULT'
  | 'CANNOT_DELETE_IN_USE'

/**
 * Domain error type for Status operations
 */
export interface StatusError extends DomainError {
  code: StatusErrorCode
}

/**
 * Factory functions for creating StatusError instances
 */
export const StatusError = {
  notFound: (id?: string): StatusError => ({
    code: 'STATUS_NOT_FOUND',
    message: id ? `Status with ID ${id} not found` : 'Status not found',
  }),

  duplicateSlug: (slug: string): StatusError => ({
    code: 'DUPLICATE_SLUG',
    message: `A status with slug '${slug}' already exists`,
  }),

  unauthorized: (action?: string): StatusError => ({
    code: 'UNAUTHORIZED',
    message: action ? `Unauthorized to ${action}` : 'Unauthorized to perform this action',
  }),

  validationError: (message: string): StatusError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),

  cannotDeleteDefault: (): StatusError => ({
    code: 'CANNOT_DELETE_DEFAULT',
    message: 'Cannot delete the default status. Set another status as default first.',
  }),

  cannotDeleteInUse: (usageCount: number): StatusError => ({
    code: 'CANNOT_DELETE_IN_USE',
    message: `Cannot delete status. ${usageCount} post(s) are using this status. Reassign them first.`,
  }),
}
