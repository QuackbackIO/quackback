/**
 * @quackback/ee/license - Enterprise License Validation
 *
 * This package handles license validation, feature gating,
 * and tier management for Quackback Enterprise.
 */

export { LicenseValidator, createFeatureGate } from './validator'
export type {
  License,
  LicenseStatus,
  LicensePayload,
  LicenseValidationResult,
  LicenseCheckOptions,
} from './types'
