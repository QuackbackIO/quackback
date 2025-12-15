'use client'

import { type ReactNode } from 'react'
import { Feature } from '@quackback/domain/features'
import { useFeatures } from '@/components/providers/features-provider'

interface FeatureGateProps {
  /** The feature required to render children */
  feature: Feature
  /** Content to render when feature is available */
  children: ReactNode
  /** Optional content to render when feature is not available */
  fallback?: ReactNode
}

/**
 * Conditionally render content based on feature access.
 *
 * Usage:
 * ```tsx
 * <FeatureGate feature={Feature.CUSTOM_DOMAIN}>
 *   <CustomDomainSettings />
 * </FeatureGate>
 *
 * // With fallback
 * <FeatureGate
 *   feature={Feature.WEBHOOKS}
 *   fallback={<UpgradePrompt feature={Feature.WEBHOOKS} />}
 * >
 *   <WebhooksSettings />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  const { hasFeature } = useFeatures()

  if (!hasFeature(feature)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}

// Re-export Feature for convenience
export { Feature }
