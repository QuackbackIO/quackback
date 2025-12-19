import { cache } from 'react'
import {
  Feature,
  type PricingTier,
  isSelfHosted,
  TIER_CONFIG,
  getMinimumTierForFeature,
} from '@quackback/domain'
import { getSubscription, isSubscriptionActive } from '../subscription'
import type { WorkspaceId } from '@quackback/ids'

export interface WorkspaceFeatures {
  /** Current edition */
  edition: 'oss' | 'cloud'
  /** Current pricing tier (null if no active subscription in cloud mode) */
  tier: PricingTier | null
  /** All features available to this organization */
  enabledFeatures: Feature[]
  /** Check if a specific feature is enabled */
  hasFeature: (feature: Feature) => boolean
  /** Get tier limits */
  limits: {
    boards: number | 'unlimited'
    posts: number | 'unlimited'
    teamMembers: number | 'unlimited'
    apiRequests: number | 'unlimited'
  } | null
}

/**
 * Get feature access info for an organization.
 * Cached per request for efficiency.
 */
export const getWorkspaceFeatures = cache(
  async (workspaceId: WorkspaceId): Promise<WorkspaceFeatures> => {
    // OSS (self-hosted): all features enabled, no limits
    if (isSelfHosted()) {
      return {
        edition: 'oss',
        tier: 'enterprise', // Effective tier for OSS
        enabledFeatures: Object.values(Feature),
        hasFeature: () => true,
        limits: {
          boards: 'unlimited',
          posts: 'unlimited',
          teamMembers: 'unlimited',
          apiRequests: 'unlimited',
        },
      }
    }

    // Cloud: check subscription
    const subscription = await getSubscription(workspaceId)

    if (!subscription || !isSubscriptionActive(subscription)) {
      // No active subscription - no features
      return {
        edition: 'cloud',
        tier: null,
        enabledFeatures: [],
        hasFeature: () => false,
        limits: null,
      }
    }

    const tier = subscription.tier
    const tierConfig = TIER_CONFIG[tier]
    const enabledFeatures = tierConfig.features

    return {
      edition: 'cloud',
      tier,
      enabledFeatures,
      hasFeature: (feature: Feature) => enabledFeatures.includes(feature),
      limits: tierConfig.limits,
    }
  }
)

/**
 * Check if an organization has a specific feature.
 * Convenience wrapper for getWorkspaceFeatures.
 */
export async function hasFeature(workspaceId: WorkspaceId, feature: Feature): Promise<boolean> {
  const features = await getWorkspaceFeatures(workspaceId)
  return features.hasFeature(feature)
}

/**
 * Check if an organization has at least a certain tier.
 */
export async function hasTier(
  workspaceId: WorkspaceId,
  requiredTier: PricingTier
): Promise<boolean> {
  // OSS always has highest tier
  if (isSelfHosted()) return true

  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.tier) return false

  const tierOrder: PricingTier[] = ['essentials', 'professional', 'team', 'enterprise']
  return tierOrder.indexOf(features.tier) >= tierOrder.indexOf(requiredTier)
}

export interface FeatureCheckResult {
  allowed: boolean
  error?: string
  requiredTier?: PricingTier
  upgradeUrl?: string
}

/**
 * Check feature access and get detailed result for API/UI responses.
 */
export async function checkFeatureAccess(
  workspaceId: WorkspaceId,
  feature: Feature
): Promise<FeatureCheckResult> {
  const features = await getWorkspaceFeatures(workspaceId)

  if (features.hasFeature(feature)) {
    return { allowed: true }
  }

  const requiredTier = getMinimumTierForFeature(feature)
  const tierName = requiredTier ? TIER_CONFIG[requiredTier].name : 'higher'

  return {
    allowed: false,
    error: `This feature requires a ${tierName} plan or higher`,
    requiredTier: requiredTier ?? undefined,
    upgradeUrl: '/admin/settings/billing',
  }
}

// Re-export Feature enum for convenience
export { Feature } from '@quackback/domain'
