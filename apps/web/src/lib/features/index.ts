/**
 * Feature flags and tier system
 *
 * Two-dimensional model:
 * 1. Deployment: self-hosted vs cloud
 * 2. Tier:
 *    - Self-hosted: community (free) vs enterprise (license key)
 *    - Cloud: free → pro → team → enterprise (subscription-based)
 */

// ============================================================================
// Build-time Constants (set by Vite define)
// ============================================================================

declare const __EDITION__: 'self-hosted' | 'cloud' | undefined
declare const __INCLUDE_EE__: boolean | undefined

// ============================================================================
// Edition & Tier Types
// ============================================================================

/**
 * Deployment edition
 */
export type Edition = 'self-hosted' | 'cloud'

/**
 * Self-hosted tiers
 * - community: Free, all standard features, no limits
 * - enterprise: Requires license key, adds SSO/SAML, SCIM, Audit Logs
 */
export type SelfHostedTier = 'community' | 'enterprise'

/**
 * Cloud subscription tiers
 */
export type CloudTier = 'free' | 'pro' | 'team' | 'enterprise'

// ============================================================================
// Edition Detection
// ============================================================================

/**
 * Check if running in self-hosted mode
 * Uses build-time constant for tree-shaking, falls back to env var
 */
export function isSelfHosted(): boolean {
  if (typeof __EDITION__ !== 'undefined') {
    return __EDITION__ !== 'cloud'
  }
  return (process.env.EDITION as string) !== 'cloud'
}

/**
 * Check if running in cloud mode
 * Uses build-time constant for tree-shaking, falls back to env var
 */
export function isCloud(): boolean {
  if (typeof __EDITION__ !== 'undefined') {
    return __EDITION__ === 'cloud'
  }
  return (process.env.EDITION as string) === 'cloud'
}

/**
 * Get current edition
 */
export function getEdition(): Edition {
  return isCloud() ? 'cloud' : 'self-hosted'
}

/**
 * Check if EE packages are included in this build
 * Used for conditional loading of EE features
 */
export function hasEEPackages(): boolean {
  if (typeof __INCLUDE_EE__ !== 'undefined') {
    return __INCLUDE_EE__
  }
  return false
}

/**
 * Check if workspace-per-database mode is enabled.
 * This requires cloud mode AND Neon API key to be configured.
 */
export function isWorkspacePerDatabase(): boolean {
  return isCloud() && Boolean(process.env.CLOUD_NEON_API_KEY)
}

/**
 * Check if multi-tenant mode is enabled (cloud with database-per-tenant).
 * When true, tenant context is resolved from catalog database on each request.
 * When false (self-hosted), uses DATABASE_URL singleton.
 */
export function isMultiTenant(): boolean {
  return isCloud() && Boolean(process.env.CLOUD_CATALOG_DATABASE_URL)
}

// ============================================================================
// Feature Definitions
// ============================================================================

/**
 * All available features in Quackback
 */
export enum Feature {
  // Core features (available to all)
  BOARDS = 'boards',
  POSTS = 'posts',
  VOTING = 'voting',
  COMMENTS = 'comments',
  OAUTH = 'oauth',
  ROADMAP = 'roadmap',
  CHANGELOG = 'changelog',

  // Pro tier (cloud) - included in self-hosted community
  CUSTOM_DOMAIN = 'custom_domain',
  CUSTOM_BRANDING = 'custom_branding',
  CUSTOM_STATUSES = 'custom_statuses',

  // Team tier (cloud) - included in self-hosted community
  INTEGRATIONS = 'integrations',
  CSV_IMPORT_EXPORT = 'csv_import_export',

  // Enterprise-only (requires license for self-hosted, enterprise tier for cloud)
  SSO_SAML = 'sso_saml',
  SCIM = 'scim',
  AUDIT_LOGS = 'audit_logs',

  // Enterprise tier extras (cloud only)
  API_ACCESS = 'api_access',
  WEBHOOKS = 'webhooks',
  WHITE_LABEL = 'white_label',
  SLA_GUARANTEE = 'sla_guarantee',
  DEDICATED_SUPPORT = 'dedicated_support',
}

// ============================================================================
// Feature Categories
// ============================================================================

/**
 * Enterprise-only features
 * These require a license key (self-hosted) or enterprise subscription (cloud)
 */
export const ENTERPRISE_ONLY_FEATURES: Feature[] = [
  Feature.SSO_SAML,
  Feature.SCIM,
  Feature.AUDIT_LOGS,
]

/**
 * Check if a feature requires enterprise tier
 */
export function isEnterpriseOnlyFeature(feature: Feature): boolean {
  return ENTERPRISE_ONLY_FEATURES.includes(feature)
}

/**
 * All features except enterprise-only
 * Available to self-hosted community and various cloud tiers
 */
const COMMUNITY_FEATURES: Feature[] = Object.values(Feature).filter(
  (f) => !ENTERPRISE_ONLY_FEATURES.includes(f)
)

/**
 * All features including enterprise
 */
const ALL_FEATURES: Feature[] = Object.values(Feature)

// ============================================================================
// Tier Limits
// ============================================================================

/**
 * Tier limits configuration
 */
export interface TierLimits {
  boards: number | 'unlimited'
  roadmaps: number | 'unlimited'
  /** Included seats (admin roles). Additional seats may be billed. */
  seats: number | 'unlimited'
  posts: number | 'unlimited'
}

/**
 * Unlimited limits for self-hosted deployments
 */
const UNLIMITED_LIMITS: TierLimits = {
  boards: 'unlimited',
  roadmaps: 'unlimited',
  seats: 'unlimited',
  posts: 'unlimited',
}

// ============================================================================
// Self-Hosted Tier Configuration
// ============================================================================

export interface SelfHostedTierConfig {
  name: string
  features: Feature[]
  limits: TierLimits
  requiresLicense: boolean
}

export const SELF_HOSTED_TIER_CONFIG: Record<SelfHostedTier, SelfHostedTierConfig> = {
  community: {
    name: 'Community',
    features: COMMUNITY_FEATURES,
    limits: UNLIMITED_LIMITS,
    requiresLicense: false,
  },
  enterprise: {
    name: 'Enterprise',
    features: ALL_FEATURES,
    limits: UNLIMITED_LIMITS,
    requiresLicense: true,
  },
}

// ============================================================================
// Cloud Tier Configuration
// ============================================================================

export interface CloudTierConfig {
  name: string
  price: number
  features: Feature[]
  limits: TierLimits
}

/**
 * Features available at each cloud tier
 * Each tier includes all features from previous tiers
 */
const CLOUD_FREE_FEATURES: Feature[] = [
  Feature.BOARDS,
  Feature.POSTS,
  Feature.VOTING,
  Feature.COMMENTS,
  Feature.OAUTH,
  Feature.ROADMAP,
  Feature.CHANGELOG,
]

const CLOUD_PRO_FEATURES: Feature[] = [
  ...CLOUD_FREE_FEATURES,
  Feature.CUSTOM_DOMAIN,
  Feature.CUSTOM_BRANDING,
  Feature.CUSTOM_STATUSES,
]

const CLOUD_TEAM_FEATURES: Feature[] = [
  ...CLOUD_PRO_FEATURES,
  Feature.INTEGRATIONS,
  Feature.CSV_IMPORT_EXPORT,
]

const CLOUD_ENTERPRISE_FEATURES: Feature[] = [
  ...CLOUD_TEAM_FEATURES,
  Feature.SSO_SAML,
  Feature.SCIM,
  Feature.AUDIT_LOGS,
  Feature.API_ACCESS,
  Feature.WEBHOOKS,
  Feature.WHITE_LABEL,
  Feature.SLA_GUARANTEE,
  Feature.DEDICATED_SUPPORT,
]

/**
 * Cloud tier order for comparison (lowest to highest)
 */
export const CLOUD_TIER_ORDER: CloudTier[] = ['free', 'pro', 'team', 'enterprise']

/**
 * Complete cloud tier configuration
 */
export const CLOUD_TIER_CONFIG: Record<CloudTier, CloudTierConfig> = {
  free: {
    name: 'Free',
    price: 0,
    features: CLOUD_FREE_FEATURES,
    limits: {
      boards: 1,
      roadmaps: 1,
      seats: 1,
      posts: 100,
    },
  },
  pro: {
    name: 'Pro',
    price: 49,
    features: CLOUD_PRO_FEATURES,
    limits: {
      boards: 5,
      roadmaps: 5,
      seats: 2,
      posts: 1000,
    },
  },
  team: {
    name: 'Team',
    price: 149,
    features: CLOUD_TEAM_FEATURES,
    limits: {
      boards: 'unlimited',
      roadmaps: 'unlimited',
      seats: 5,
      posts: 10000,
    },
  },
  enterprise: {
    name: 'Enterprise',
    price: 499,
    features: CLOUD_ENTERPRISE_FEATURES,
    limits: {
      boards: 'unlimited',
      roadmaps: 'unlimited',
      seats: 10,
      posts: 'unlimited',
    },
  },
}

/**
 * Seat pricing per cloud tier (additional seats beyond included)
 */
export const CLOUD_SEAT_PRICING: Record<Exclude<CloudTier, 'free'>, number> = {
  pro: 15,
  team: 20,
  enterprise: 30,
}

// ============================================================================
// Cloud Tier Helpers
// ============================================================================

/**
 * Get all features available for a cloud tier
 */
export function getFeaturesForCloudTier(tier: CloudTier): Feature[] {
  return CLOUD_TIER_CONFIG[tier].features
}

/**
 * Check if a feature is available for a cloud tier
 */
export function cloudTierHasFeature(tier: CloudTier, feature: Feature): boolean {
  return CLOUD_TIER_CONFIG[tier].features.includes(feature)
}

/**
 * Get the minimum cloud tier required for a feature
 */
export function getMinimumCloudTierForFeature(feature: Feature): CloudTier | null {
  for (const tier of CLOUD_TIER_ORDER) {
    if (cloudTierHasFeature(tier, feature)) {
      return tier
    }
  }
  return null
}

/**
 * Get cloud tier configuration
 */
export function getCloudTierConfig(tier: CloudTier): CloudTierConfig {
  return CLOUD_TIER_CONFIG[tier]
}

/**
 * Check if one cloud tier is higher than or equal to another
 */
export function isCloudTierAtLeast(currentTier: CloudTier, requiredTier: CloudTier): boolean {
  return CLOUD_TIER_ORDER.indexOf(currentTier) >= CLOUD_TIER_ORDER.indexOf(requiredTier)
}

// ============================================================================
// Self-Hosted Tier Helpers
// ============================================================================

/**
 * Get all features available for a self-hosted tier
 */
export function getFeaturesForSelfHostedTier(tier: SelfHostedTier): Feature[] {
  return SELF_HOSTED_TIER_CONFIG[tier].features
}

/**
 * Check if a feature is available for a self-hosted tier
 */
export function selfHostedTierHasFeature(tier: SelfHostedTier, feature: Feature): boolean {
  return SELF_HOSTED_TIER_CONFIG[tier].features.includes(feature)
}

/**
 * Get self-hosted tier configuration
 */
export function getSelfHostedTierConfig(tier: SelfHostedTier): SelfHostedTierConfig {
  return SELF_HOSTED_TIER_CONFIG[tier]
}

// ============================================================================
// Feature Requirement Helpers
// ============================================================================

/**
 * Get human-readable requirement for a feature
 */
export function getFeatureRequirement(feature: Feature): string {
  if (isEnterpriseOnlyFeature(feature)) {
    return 'Requires Enterprise'
  }
  const minTier = getMinimumCloudTierForFeature(feature)
  if (minTier && minTier !== 'free') {
    return `Requires ${CLOUD_TIER_CONFIG[minTier].name}`
  }
  return 'Available'
}
