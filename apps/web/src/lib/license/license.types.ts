/**
 * License types for self-hosted enterprise
 */

/**
 * License information returned by validation
 */
export interface LicenseInfo {
  /** Whether the license is valid */
  valid: boolean
  /** License tier (always 'enterprise' for valid licenses) */
  tier: 'enterprise'
  /** When the license expires (null = never) */
  expiresAt: Date | null
  /** Name of the license holder */
  licensee: string | null
  /** Maximum number of seats (null = unlimited) */
  seats: number | null
}

/**
 * Invalid/missing license placeholder
 */
export const NO_LICENSE: LicenseInfo = {
  valid: false,
  tier: 'enterprise',
  expiresAt: null,
  licensee: null,
  seats: null,
}
