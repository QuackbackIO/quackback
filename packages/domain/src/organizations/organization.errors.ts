/**
 * Error types for OrganizationService operations
 */

import type { DomainError } from '../shared/result'

export type OrgErrorCode =
  | 'ORGANIZATION_NOT_FOUND'
  | 'SSO_PROVIDER_NOT_FOUND'
  | 'DUPLICATE_DOMAIN'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'

export interface OrgError extends DomainError {
  code: OrgErrorCode
}

export const OrgError = {
  notFound: (id?: string): OrgError => ({
    code: 'ORGANIZATION_NOT_FOUND',
    message: id ? `Organization with ID ${id} not found` : 'Organization not found',
  }),

  ssoProviderNotFound: (id: string): OrgError => ({
    code: 'SSO_PROVIDER_NOT_FOUND',
    message: `SSO provider with ID ${id} not found`,
  }),

  duplicateDomain: (domain: string): OrgError => ({
    code: 'DUPLICATE_DOMAIN',
    message: `SSO provider with domain ${domain} already exists`,
  }),

  unauthorized: (action: string): OrgError => ({
    code: 'UNAUTHORIZED',
    message: `You do not have permission to ${action}`,
  }),

  validationError: (message: string): OrgError => ({
    code: 'VALIDATION_ERROR',
    message,
  }),
}
