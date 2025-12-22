/**
 * Error types for SettingsService operations
 */

import type { DomainError } from '../shared/result'

export type SettingsErrorCode = 'SETTINGS_NOT_FOUND' | 'UNAUTHORIZED' | 'VALIDATION_ERROR'

export interface SettingsError extends DomainError {
  code: SettingsErrorCode
}

export const SettingsError = {
  notFound: (id?: string): SettingsError => ({
    code: 'SETTINGS_NOT_FOUND',
    message: id ? `Settings with ID ${id} not found` : 'Settings not found',
  }),

  unauthorized: (action: string): SettingsError => ({
    code: 'UNAUTHORIZED',
    message: `You do not have permission to ${action}`,
  }),

  validationError: (message: string): SettingsError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),
}

// Backwards compatibility aliases
export type WorkspaceErrorCode = SettingsErrorCode
export type WorkspaceError = SettingsError
export const WorkspaceError = SettingsError
