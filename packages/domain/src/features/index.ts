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
  // Essentials (base tier) - $29/mo
  BOARDS = 'boards',
  POSTS = 'posts',
  VOTING = 'voting',
  COMMENTS = 'comments',
  OAUTH = 'oauth',
  ROADMAP = 'roadmap',
  CHANGELOG = 'changelog',

  // Professional - $79/mo
  CUSTOM_DOMAIN = 'custom_domain',
  WEBHOOKS = 'webhooks',
  API_ACCESS = 'api_access',
  BASIC_ANALYTICS = 'basic_analytics',
  CUSTOM_BRANDING = 'custom_branding',

  // Team - $199/mo
  SSO_SAML = 'sso_saml',
  SCIM = 'scim',
  AUDIT_LOGS = 'audit_logs',
  INTEGRATIONS = 'integrations',
  TEAM_ROLES = 'team_roles',

  // Enterprise - Custom pricing
  EXTENDED_AUDIT_LOGS = 'extended_audit_logs',
  WHITE_LABEL = 'white_label',
  CUSTOM_SSO = 'custom_sso',
  DEDICATED_SUPPORT = 'dedicated_support',
  SLA_GUARANTEE = 'sla_guarantee',
}

/**
 * Pricing tiers (no free tier)
 */
export type PricingTier = 'essentials' | 'professional' | 'team' | 'enterprise'

/**
 * Tier configuration with pricing and limits
 */
export interface TierConfig {
  name: string
  price: number | 'custom'
  features: Feature[]
  limits: {
    boards: number | 'unlimited'
    posts: number | 'unlimited'
    teamMembers: number | 'unlimited'
    apiRequests: number | 'unlimited'
  }
}

/**
 * Features available at each tier
 * Each tier includes all features from previous tiers
 */
const ESSENTIALS_FEATURES: Feature[] = [
  Feature.BOARDS,
  Feature.POSTS,
  Feature.VOTING,
  Feature.COMMENTS,
  Feature.OAUTH,
  Feature.ROADMAP,
  Feature.CHANGELOG,
]

const PROFESSIONAL_FEATURES: Feature[] = [
  ...ESSENTIALS_FEATURES,
  Feature.CUSTOM_DOMAIN,
  Feature.WEBHOOKS,
  Feature.API_ACCESS,
  Feature.BASIC_ANALYTICS,
  Feature.CUSTOM_BRANDING,
]

const TEAM_FEATURES: Feature[] = [
  ...PROFESSIONAL_FEATURES,
  Feature.SSO_SAML,
  Feature.SCIM,
  Feature.AUDIT_LOGS,
  Feature.INTEGRATIONS,
  Feature.TEAM_ROLES,
]

const ENTERPRISE_FEATURES: Feature[] = [
  ...TEAM_FEATURES,
  Feature.EXTENDED_AUDIT_LOGS,
  Feature.WHITE_LABEL,
  Feature.CUSTOM_SSO,
  Feature.DEDICATED_SUPPORT,
  Feature.SLA_GUARANTEE,
]

/**
 * Complete tier configuration
 */
export const TIER_CONFIG: Record<PricingTier, TierConfig> = {
  essentials: {
    name: 'Essentials',
    price: 29,
    features: ESSENTIALS_FEATURES,
    limits: {
      boards: 1,
      posts: 100,
      teamMembers: 1,
      apiRequests: 1000,
    },
  },
  professional: {
    name: 'Professional',
    price: 79,
    features: PROFESSIONAL_FEATURES,
    limits: {
      boards: 3,
      posts: 1000,
      teamMembers: 3,
      apiRequests: 10000,
    },
  },
  team: {
    name: 'Team',
    price: 199,
    features: TEAM_FEATURES,
    limits: {
      boards: 10,
      posts: 10000,
      teamMembers: 10,
      apiRequests: 50000,
    },
  },
  enterprise: {
    name: 'Enterprise',
    price: 'custom',
    features: ENTERPRISE_FEATURES,
    limits: {
      boards: 'unlimited',
      posts: 'unlimited',
      teamMembers: 'unlimited',
      apiRequests: 'unlimited',
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
  const tiers: PricingTier[] = ['essentials', 'professional', 'team', 'enterprise']

  for (const tier of tiers) {
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
  const tierOrder: PricingTier[] = ['essentials', 'professional', 'team', 'enterprise']
  return tierOrder.indexOf(currentTier) >= tierOrder.indexOf(requiredTier)
}

/**
 * Features that require enterprise code from ee/
 */
export const ENTERPRISE_CODE_FEATURES: Feature[] = [
  Feature.SSO_SAML,
  Feature.SCIM,
  Feature.AUDIT_LOGS,
  Feature.EXTENDED_AUDIT_LOGS,
  Feature.WHITE_LABEL,
  Feature.CUSTOM_SSO,
]

/**
 * Check if a feature requires enterprise code
 */
export function requiresEnterpriseCode(feature: Feature): boolean {
  return ENTERPRISE_CODE_FEATURES.includes(feature)
}
