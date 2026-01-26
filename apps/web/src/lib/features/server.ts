import { cache } from 'react'
import {
  Feature,
  type Edition,
  type SelfHostedTier,
  type CloudTier,
  type TierLimits,
  isSelfHosted,
  CLOUD_TIER_CONFIG,
  CLOUD_TIER_ORDER,
  SELF_HOSTED_TIER_CONFIG,
  getMinimumCloudTierForFeature,
} from '@/lib/features'
import { getSubscription, isSubscriptionActive } from '../subscription'
import { tenantStorage } from '../tenant/storage'
import { getBillingUrl } from '../config'

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceFeatures {
  /** Deployment edition */
  edition: Edition
  /** Self-hosted tier (community) - null for cloud */
  selfHostedTier: SelfHostedTier | null
  /** Cloud subscription tier - null for self-hosted */
  cloudTier: CloudTier | null
  /** All features available to this workspace */
  enabledFeatures: Feature[]
  /** Check if a specific feature is enabled */
  hasFeature: (feature: Feature) => boolean
  /** Resource limits */
  limits: TierLimits
}

// ============================================================================
// Main Feature Access
// ============================================================================

/**
 * Get feature access info for the workspace.
 * Cached per request for efficiency.
 *
 * For cloud mode, reads subscription from tenant context (sync).
 * For self-hosted mode, returns community tier.
 */
export const getWorkspaceFeatures = cache(async (): Promise<WorkspaceFeatures> => {
  if (isSelfHosted()) {
    return getSelfHostedFeatures()
  }
  // Cloud features are sync since subscription is in tenant context
  return getCloudFeatures()
})

/**
 * Get features for self-hosted deployment
 * Self-hosted always gets the community tier with all features
 */
function getSelfHostedFeatures(): WorkspaceFeatures {
  const config = SELF_HOSTED_TIER_CONFIG.community
  return {
    edition: 'self-hosted',
    selfHostedTier: 'community',
    cloudTier: null,
    enabledFeatures: config.features,
    hasFeature: (feature: Feature) => config.features.includes(feature),
    limits: config.limits,
  }
}

/**
 * Get features for cloud deployment.
 * Reads subscription from tenant context (populated during resolution).
 */
function getCloudFeatures(): WorkspaceFeatures {
  const subscription = getSubscription()

  // No active subscription = Free tier
  if (!subscription || !isSubscriptionActive(subscription)) {
    const config = CLOUD_TIER_CONFIG.free
    return {
      edition: 'cloud',
      selfHostedTier: null,
      cloudTier: 'free',
      enabledFeatures: config.features,
      hasFeature: (feature: Feature) => config.features.includes(feature),
      limits: config.limits,
    }
  }

  const tier = subscription.tier as CloudTier
  const config = CLOUD_TIER_CONFIG[tier]

  return {
    edition: 'cloud',
    selfHostedTier: null,
    cloudTier: tier,
    enabledFeatures: config.features,
    hasFeature: (feature: Feature) => config.features.includes(feature),
    limits: config.limits,
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Check if the workspace has a specific feature.
 */
export async function hasFeature(feature: Feature): Promise<boolean> {
  const features = await getWorkspaceFeatures()
  return features.hasFeature(feature)
}

/**
 * Check if the workspace has at least a certain cloud tier.
 * Always returns true for self-hosted deployments.
 */
export async function hasCloudTier(requiredTier: CloudTier): Promise<boolean> {
  if (isSelfHosted()) return true

  const features = await getWorkspaceFeatures()
  if (!features.cloudTier) return false
  return CLOUD_TIER_ORDER.indexOf(features.cloudTier) >= CLOUD_TIER_ORDER.indexOf(requiredTier)
}

// ============================================================================
// Feature Access Checking
// ============================================================================

export interface FeatureCheckResult {
  allowed: boolean
  error?: string
  requiredTier?: CloudTier
  upgradeUrl?: string
}

/**
 * Build the billing URL for upgrade prompts.
 * Self-hosted has all features; cloud uses external billing page.
 */
function getBillingUpgradeUrl(): string {
  if (isSelfHosted()) {
    // Self-hosted community has all features, no upgrade needed
    return '/admin/settings'
  }

  // Cloud: use external billing URL with workspace ID
  const tenant = tenantStorage.getStore()
  return getBillingUrl(tenant?.workspaceId)
}

/**
 * Check feature access and get detailed result for API/UI responses.
 */
export async function checkFeatureAccess(feature: Feature): Promise<FeatureCheckResult> {
  const features = await getWorkspaceFeatures()

  if (features.hasFeature(feature)) {
    return { allowed: true }
  }

  // Cloud tier requirement
  const requiredTier = getMinimumCloudTierForFeature(feature)
  const tierName = requiredTier ? CLOUD_TIER_CONFIG[requiredTier].name : 'higher'

  return {
    allowed: false,
    error: `This feature requires a ${tierName} plan or higher`,
    requiredTier: requiredTier ?? undefined,
    upgradeUrl: getBillingUpgradeUrl(),
  }
}

// Re-export Feature enum for convenience
export { Feature } from '@/lib/features'
