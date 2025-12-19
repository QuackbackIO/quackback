/**
 * Error types for WorkspaceService operations
 */

import type { DomainError } from '../shared/result'

export type WorkspaceErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'SSO_PROVIDER_NOT_FOUND'
  | 'DUPLICATE_DOMAIN'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'

export interface WorkspaceError extends DomainError {
  code: WorkspaceErrorCode
}

export const WorkspaceError = {
  notFound: (id?: string): WorkspaceError => ({
    code: 'WORKSPACE_NOT_FOUND',
    message: id ? `Workspace with ID ${id} not found` : 'Workspace not found',
  }),

  ssoProviderNotFound: (id: string): WorkspaceError => ({
    code: 'SSO_PROVIDER_NOT_FOUND',
    message: `SSO provider with ID ${id} not found`,
  }),

  duplicateDomain: (domain: string): WorkspaceError => ({
    code: 'DUPLICATE_DOMAIN',
    message: `SSO provider with domain ${domain} already exists`,
  }),

  unauthorized: (action: string): WorkspaceError => ({
    code: 'UNAUTHORIZED',
    message: `You do not have permission to ${action}`,
  }),

  validationError: (message: string): WorkspaceError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),
}
