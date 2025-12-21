/**
 * Feature flags and pricing tier system
 *
 * Business model:
 * - Self-hosted: All features enabled (no restrictions)
 * - Managed cloud: Features gated by subscription tier
 */

/**
 * Edition detection
 * OSS (self-hosted) deployments get ALL features without restrictions
 */
export type Edition = 'oss' | 'cloud'

/**
 * Check if running in OSS (self-hosted) mode
 * OSS = all features enabled, no tier checks needed
 *
 * @returns true if OSS/self-hosted (default), false if cloud
 */
export function isSelfHosted(): boolean {
  // Default to OSS (more permissive) if not specified
  return process.env.EDITION !== 'cloud'
}

/**
 * Check if running in cloud mode
 */
export function isCloud(): boolean {
  return process.env.EDITION === 'cloud'
}

/**
 * Get current edition
 */
export function getEdition(): Edition {
  return isCloud() ? 'cloud' : 'oss'
}

/**
 * All available features in Quackback
 * Note: Self-hosted gets ALL features. Tiers only apply to cloud.
 */
export enum Feature {
  // Free tier - $0/mo
  BOARDS = 'boards',
  POSTS = 'posts',
  VOTING = 'voting',
  COMMENTS = 'comments',
  OAUTH = 'oauth',
  ROADMAP = 'roadmap',
  CHANGELOG = 'changelog',

  // Pro tier - $49/mo
  CUSTOM_DOMAIN = 'custom_domain',
  CUSTOM_BRANDING = 'custom_branding',
  CUSTOM_STATUSES = 'custom_statuses',

  // Team tier - $149/mo
  INTEGRATIONS = 'integrations',
  CSV_IMPORT_EXPORT = 'csv_import_export',

  // Enterprise tier - $499/mo
  SSO_SAML = 'sso_saml',
  SCIM = 'scim',
  AUDIT_LOGS = 'audit_logs',
  API_ACCESS = 'api_access',
  WEBHOOKS = 'webhooks',
  WHITE_LABEL = 'white_label',
  SLA_GUARANTEE = 'sla_guarantee',
  DEDICATED_SUPPORT = 'dedicated_support',

  // Legacy features (kept for backwards compatibility)
  BASIC_ANALYTICS = 'basic_analytics',
  TEAM_ROLES = 'team_roles',
  EXTENDED_AUDIT_LOGS = 'extended_audit_logs',
  CUSTOM_SSO = 'custom_sso',
}

/**
 * Pricing tiers
 */
export type PricingTier = 'free' | 'pro' | 'team' | 'enterprise'

/**
 * Tier limits configuration
 */
export interface TierLimits {
  boards: number | 'unlimited'
  roadmaps: number | 'unlimited'
  /** Included seats (owner + admin roles). Additional seats are billed per SEAT_PRICING. */
  seats: number | 'unlimited'
  posts: number | 'unlimited'
}

/**
 * Tier configuration with pricing and limits
 */
export interface TierConfig {
  name: string
  price: number
  features: Feature[]
  limits: TierLimits
}

/**
 * Seat pricing per tier (additional seats beyond included)
 */
export const SEAT_PRICING: Record<Exclude<PricingTier, 'free'>, number> = {
  pro: 15,
  team: 20,
  enterprise: 30,
}

/**
 * Features available at each tier
 * Each tier includes all features from previous tiers
 */
const FREE_FEATURES: Feature[] = [
  Feature.BOARDS,
  Feature.POSTS,
  Feature.VOTING,
  Feature.COMMENTS,
  Feature.OAUTH,
  Feature.ROADMAP,
  Feature.CHANGELOG,
]

const PRO_FEATURES: Feature[] = [
  ...FREE_FEATURES,
  Feature.CUSTOM_DOMAIN,
  Feature.CUSTOM_BRANDING,
  Feature.CUSTOM_STATUSES,
]

const TEAM_FEATURES: Feature[] = [...PRO_FEATURES, Feature.INTEGRATIONS, Feature.CSV_IMPORT_EXPORT]

const ENTERPRISE_FEATURES: Feature[] = [
  ...TEAM_FEATURES,
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
 * Tier order for comparison (lowest to highest)
 */
export const TIER_ORDER: PricingTier[] = ['free', 'pro', 'team', 'enterprise']

/**
 * Complete tier configuration
 */
export const TIER_CONFIG: Record<PricingTier, TierConfig> = {
  free: {
    name: 'Free',
    price: 0,
    features: FREE_FEATURES,
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
    features: PRO_FEATURES,
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
    features: TEAM_FEATURES,
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
    features: ENTERPRISE_FEATURES,
    limits: {
      boards: 'unlimited',
      roadmaps: 'unlimited',
      seats: 10,
      posts: 'unlimited',
    },
  },
}

/**
 * Get all features available for a tier (including inherited features)
 */
export function getFeaturesForTier(tier: PricingTier): Feature[] {
  return TIER_CONFIG[tier].features
}

/**
 * Check if a feature is available for a tier
 */
export function tierHasFeature(tier: PricingTier, feature: Feature): boolean {
  return TIER_CONFIG[tier].features.includes(feature)
}

/**
 * Get the minimum tier required for a feature
 */
export function getMinimumTierForFeature(feature: Feature): PricingTier | null {
  for (const tier of TIER_ORDER) {
    if (tierHasFeature(tier, feature)) {
      return tier
    }
  }

  return null
}

/**
 * Get tier configuration
 */
export function getTierConfig(tier: PricingTier): TierConfig {
  return TIER_CONFIG[tier]
}

/**
 * Check if one tier is higher than or equal to another
 */
export function isTierAtLeast(currentTier: PricingTier, requiredTier: PricingTier): boolean {
  return TIER_ORDER.indexOf(currentTier) >= TIER_ORDER.indexOf(requiredTier)
}

/**
 * Features that require enterprise code from ee/
 */
export const ENTERPRISE_CODE_FEATURES: Feature[] = [
  Feature.SSO_SAML,
  Feature.SCIM,
  Feature.AUDIT_LOGS,
  Feature.WHITE_LABEL,
]

/**
 * Check if a feature requires enterprise code
 */
export function requiresEnterpriseCode(feature: Feature): boolean {
  return ENTERPRISE_CODE_FEATURES.includes(feature)
}
