import { cache } from 'react'
import {
  Feature,
  type PricingTier,
  type TierLimits,
  isSelfHosted,
  TIER_CONFIG,
  TIER_ORDER,
  getMinimumTierForFeature,
} from '@quackback/domain'
import { getSubscription, isSubscriptionActive } from '../subscription'
import type { WorkspaceId } from '@quackback/ids'

export interface WorkspaceFeatures {
  /** Current edition */
  edition: 'oss' | 'cloud'
  /** Current pricing tier */
  tier: PricingTier
  /** All features available to this organization */
  enabledFeatures: Feature[]
  /** Check if a specific feature is enabled */
  hasFeature: (feature: Feature) => boolean
  /** Get tier limits */
  limits: TierLimits
}

/**
 * Get feature access info for an organization.
 * Cached per request for efficiency.
 */
export const getWorkspaceFeatures = cache(
  async (_workspaceId: WorkspaceId): Promise<WorkspaceFeatures> => {
    // OSS (self-hosted): all features enabled, no limits
    if (isSelfHosted()) {
      return {
        edition: 'oss',
        tier: 'enterprise', // Effective tier for OSS
        enabledFeatures: Object.values(Feature),
        hasFeature: () => true,
        limits: {
          boards: 'unlimited',
          roadmaps: 'unlimited',
          seats: 'unlimited',
          posts: 'unlimited',
        },
      }
    }

    // Cloud: check subscription
    const subscription = await getSubscription()

    // No active subscription = Free tier
    if (!subscription || !isSubscriptionActive(subscription)) {
      const freeTierConfig = TIER_CONFIG['free']
      return {
        edition: 'cloud',
        tier: 'free',
        enabledFeatures: freeTierConfig.features,
        hasFeature: (feature: Feature) => freeTierConfig.features.includes(feature),
        limits: freeTierConfig.limits,
      }
    }

    const tier = subscription.tier as PricingTier
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
  return TIER_ORDER.indexOf(features.tier) >= TIER_ORDER.indexOf(requiredTier)
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
