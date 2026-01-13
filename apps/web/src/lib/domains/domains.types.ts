/**
 * Domain Types
 *
 * Type definitions for custom domain management.
 * This module defines types for domain records stored in the catalog database.
 */

/**
 * Domain type - subdomain (default) or custom domain
 */
export type DomainType = 'subdomain' | 'custom'

/**
 * SSL status from Cloudflare
 */
export type SslStatus =
  | 'initializing'
  | 'pending_validation'
  | 'pending_issuance'
  | 'pending_deployment'
  | 'active'
  | 'expired'
  | 'deleted'

/**
 * Ownership verification status from Cloudflare
 */
export type OwnershipStatus = 'pending' | 'active' | 'moved' | 'blocked' | 'deleted'

/**
 * Domain record from catalog database
 */
export interface Domain {
  id: string
  workspaceId: string
  domain: string
  domainType: DomainType
  isPrimary: boolean
  verified: boolean
  verificationToken: string | null
  cloudflareHostnameId: string | null
  sslStatus: SslStatus | null
  ownershipStatus: OwnershipStatus | null
  createdAt: Date
}

/**
 * Input for adding a custom domain
 */
export interface AddDomainInput {
  domain: string
}

/**
 * DNS verification records from Cloudflare
 */
export interface VerificationRecords {
  /** CNAME target for domain verification (points to fallback origin) */
  cnameTarget?: string
  /** TXT record name for ACME challenge */
  txtName?: string
  /** TXT record value for ACME challenge */
  txtValue?: string
  /** HTTP validation URL */
  httpUrl?: string
  /** HTTP validation body content */
  httpBody?: string
}

/**
 * Domain status including Cloudflare verification details
 */
export interface DomainStatus {
  sslStatus: SslStatus | null
  ownershipStatus: OwnershipStatus | null
  verificationRecords?: VerificationRecords
}

/**
 * Domain display status for UI
 */
export type DomainDisplayStatus =
  | 'configuring'
  | 'awaiting_dns'
  | 'issuing_certificate'
  | 'deploying'
  | 'active'
  | 'expired'
  | 'error'

/**
 * Map SSL status to display status
 */
export function getDisplayStatus(sslStatus: SslStatus | null): DomainDisplayStatus {
  switch (sslStatus) {
    case 'initializing':
      return 'configuring'
    case 'pending_validation':
      return 'awaiting_dns'
    case 'pending_issuance':
      return 'issuing_certificate'
    case 'pending_deployment':
      return 'deploying'
    case 'active':
      return 'active'
    case 'expired':
      return 'expired'
    case 'deleted':
    case null:
    default:
      return 'error'
  }
}
