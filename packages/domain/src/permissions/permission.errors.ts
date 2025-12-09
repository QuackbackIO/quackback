/**
 * Permission error types for the permission service
 */

export type PermissionErrorCode = 'ORG_NOT_FOUND' | 'BOARD_NOT_FOUND' | 'VALIDATION_ERROR'

export interface PermissionError {
  code: PermissionErrorCode
  message: string
}

/**
 * Error factory for permission errors
 */
export const PermissionError = {
  orgNotFound: (id?: string): PermissionError => ({
    code: 'ORG_NOT_FOUND',
    message: id ? `Organization ${id} not found` : 'Organization not found',
  }),

  boardNotFound: (id: string): PermissionError => ({
    code: 'BOARD_NOT_FOUND',
    message: `Board ${id} not found`,
  }),

  validationError: (message: string): PermissionError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),
}
