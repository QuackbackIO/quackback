/**
 * Feature flags and tier system
 *
 * Two-dimensional model:
 * 1. Deployment: self-hosted vs cloud
 * 2. Tier:
 *    - Self-hosted: community (free, all features, no limits)
 *    - Cloud: free → pro → team (subscription-based)
 */

// ============================================================================
// Build-time Constants (set by Vite define)
// ============================================================================

declare const __EDITION__: 'self-hosted' | 'cloud' | undefined

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
 */
export type SelfHostedTier = 'community'

/**
 * Cloud subscription tiers
 */
export type CloudTier = 'free' | 'pro' | 'team'

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
 * Check if workspace-per-database mode is enabled.
 * This requires cloud mode AND a catalog database to be configured.
 */
export function isWorkspacePerDatabase(): boolean {
  return isCloud() && Boolean(process.env.CLOUD_CATALOG_DATABASE_URL)
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
  API_ACCESS = 'api_access',
  WEBHOOKS = 'webhooks',
}

/**
 * All available features
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
}

export const SELF_HOSTED_TIER_CONFIG: Record<SelfHostedTier, SelfHostedTierConfig> = {
  community: {
    name: 'Community',
    features: ALL_FEATURES,
    limits: UNLIMITED_LIMITS,
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
  Feature.API_ACCESS,
  Feature.WEBHOOKS,
]

/**
 * Cloud tier order for comparison (lowest to highest)
 */
export const CLOUD_TIER_ORDER: CloudTier[] = ['free', 'pro', 'team']

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
}

/**
 * Seat pricing per cloud tier (additional seats beyond included)
 */
export const CLOUD_SEAT_PRICING: Record<Exclude<CloudTier, 'free'>, number> = {
  pro: 15,
  team: 20,
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
  const minTier = getMinimumCloudTierForFeature(feature)
  if (minTier && minTier !== 'free') {
    return `Requires ${CLOUD_TIER_CONFIG[minTier].name}`
  }
  return 'Available'
}
