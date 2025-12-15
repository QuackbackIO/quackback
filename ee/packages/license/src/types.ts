/**
 * License Types for Quackback Enterprise
 */

import type { PricingTier } from '@quackback/domain'
import type { OrgId } from '@quackback/ids'

/**
 * License status
 */
export type LicenseStatus = 'active' | 'expired' | 'invalid' | 'trial'

/**
 * License data stored in database
 */
export interface License {
  id: string
  organizationId: OrgId
  tier: PricingTier
  status: LicenseStatus
  licenseKey: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date

  // Optional metadata
  seats?: number
  customerId?: string
  subscriptionId?: string
}

/**
 * Decoded license key payload
 */
export interface LicensePayload {
  organizationId: OrgId
  tier: PricingTier
  expiresAt: number // Unix timestamp
  seats: number
  issuedAt: number
  version: number
}

/**
 * License validation result
 */
export interface LicenseValidationResult {
  valid: boolean
  license: License | null
  error?: string
  expiresIn?: number // Days until expiration
}

/**
 * License check options
 */
export interface LicenseCheckOptions {
  /**
   * If true, also validates the license key signature
   */
  validateSignature?: boolean

  /**
   * If true, allows expired licenses (for grace period)
   */
  allowExpired?: boolean

  /**
   * Grace period in days for expired licenses
   */
  gracePeriodDays?: number
}
