/**
 * License Validator for Quackback Enterprise
 *
 * Validates license keys and checks feature access.
 *
 * IMPORTANT: This only applies to CLOUD deployments.
 * Self-hosted deployments bypass ALL license checks and get ALL features free.
 */

import {
  Feature,
  type PricingTier,
  tierHasFeature,
  isTierAtLeast,
  requiresEnterpriseCode,
  isSelfHosted,
} from '@quackback/domain'
import type { OrgId } from '@quackback/ids'
import type { License, LicenseValidationResult, LicenseCheckOptions } from './types'

// Cache licenses to avoid repeated database lookups
const licenseCache = new Map<string, { license: License | null; cachedAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * LicenseValidator handles all license-related operations
 */
export class LicenseValidator {
  private getLicenseFromDb: (organizationId: OrgId) => Promise<License | null>

  constructor(getLicenseFromDb: (organizationId: OrgId) => Promise<License | null>) {
    this.getLicenseFromDb = getLicenseFromDb
  }

  /**
   * Get license for an organization (with caching)
   */
  async getLicense(organizationId: OrgId, skipCache = false): Promise<License | null> {
    const cacheKey = organizationId
    const cached = licenseCache.get(cacheKey)

    if (!skipCache && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.license
    }

    const license = await this.getLicenseFromDb(organizationId)

    licenseCache.set(cacheKey, {
      license,
      cachedAt: Date.now(),
    })

    return license
  }

  /**
   * Validate a license
   */
  async validateLicense(
    organizationId: OrgId,
    options: LicenseCheckOptions = {}
  ): Promise<LicenseValidationResult> {
    const { allowExpired = false, gracePeriodDays = 7 } = options

    const license = await this.getLicense(organizationId)

    if (!license) {
      return {
        valid: false,
        license: null,
        error: 'No license found',
      }
    }

    // Check if license is active
    if (license.status === 'invalid') {
      return {
        valid: false,
        license,
        error: 'License has been invalidated',
      }
    }

    // Check expiration
    const now = new Date()
    const expiresAt = new Date(license.expiresAt)
    const daysUntilExpiration = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (expiresAt < now) {
      // License is expired
      if (!allowExpired) {
        return {
          valid: false,
          license,
          error: 'License has expired',
          expiresIn: daysUntilExpiration,
        }
      }

      // Check grace period
      const gracePeriodEnd = new Date(expiresAt.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000)
      if (now > gracePeriodEnd) {
        return {
          valid: false,
          license,
          error: 'License expired and grace period has ended',
          expiresIn: daysUntilExpiration,
        }
      }
    }

    return {
      valid: true,
      license,
      expiresIn: daysUntilExpiration,
    }
  }

  /**
   * Check if an organization has access to a feature
   *
   * Self-hosted deployments ALWAYS return true (all features free).
   * Cloud deployments check subscription tier.
   */
  async hasFeature(organizationId: OrgId, feature: Feature): Promise<boolean> {
    // Self-hosted: ALL features enabled, no checks needed
    if (isSelfHosted()) {
      return true
    }

    // Cloud: Check subscription/license
    const license = await this.getLicense(organizationId)

    if (!license) {
      return false
    }

    // Check if license is valid
    if (license.status !== 'active' && license.status !== 'trial') {
      return false
    }

    // Check expiration
    if (new Date(license.expiresAt) < new Date()) {
      return false
    }

    // Check if tier includes the feature
    return tierHasFeature(license.tier, feature)
  }

  /**
   * Check if an organization has at least a certain tier
   *
   * Self-hosted: Always returns true (equivalent to enterprise tier).
   */
  async hasTier(organizationId: OrgId, requiredTier: PricingTier): Promise<boolean> {
    // Self-hosted: Equivalent to enterprise tier (highest)
    if (isSelfHosted()) {
      return true
    }

    const license = await this.getLicense(organizationId)

    if (!license) {
      return false
    }

    if (license.status !== 'active' && license.status !== 'trial') {
      return false
    }

    if (new Date(license.expiresAt) < new Date()) {
      return false
    }

    return isTierAtLeast(license.tier, requiredTier)
  }

  /**
   * Get the current tier for an organization
   *
   * Self-hosted: Returns 'enterprise' (all features available).
   */
  async getTier(organizationId: OrgId): Promise<PricingTier | null> {
    // Self-hosted: Equivalent to enterprise tier
    if (isSelfHosted()) {
      return 'enterprise'
    }

    const license = await this.getLicense(organizationId)

    if (!license) {
      return null
    }

    if (license.status !== 'active' && license.status !== 'trial') {
      return null
    }

    if (new Date(license.expiresAt) < new Date()) {
      return null
    }

    return license.tier
  }

  /**
   * Clear the license cache for an organization
   */
  clearCache(organizationId?: OrgId): void {
    if (organizationId) {
      licenseCache.delete(organizationId)
    } else {
      licenseCache.clear()
    }
  }
}

/**
 * Create a feature gate function for use in API routes
 */
export function createFeatureGate(validator: LicenseValidator) {
  return async function requireFeature(
    organizationId: OrgId,
    feature: Feature
  ): Promise<{ allowed: boolean; error?: string; upgradeUrl?: string }> {
    const hasAccess = await validator.hasFeature(organizationId, feature)

    if (hasAccess) {
      return { allowed: true }
    }

    // Check if it's an enterprise code feature
    const needsEnterpriseCode = requiresEnterpriseCode(feature)

    return {
      allowed: false,
      error: needsEnterpriseCode
        ? `This feature requires a Team or Enterprise plan`
        : `This feature requires a higher plan`,
      upgradeUrl: '/settings/billing',
    }
  }
}
