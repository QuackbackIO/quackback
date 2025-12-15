'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Feature, type PricingTier } from '@quackback/domain/features'
import { featuresKeys, type OrganizationFeaturesData } from '@/lib/hooks/use-features'

interface FeaturesContextValue {
  organizationId: string
  edition: 'oss' | 'cloud'
  tier: PricingTier | null
  enabledFeatures: Feature[]
  hasFeature: (feature: Feature) => boolean
  limits: {
    boards: number | 'unlimited'
    posts: number | 'unlimited'
    teamMembers: number | 'unlimited'
    apiRequests: number | 'unlimited'
  } | null
}

const FeaturesContext = createContext<FeaturesContextValue | null>(null)

interface FeaturesProviderProps {
  children: ReactNode
  organizationId: string
  /** SSR-fetched features data for hydration */
  initialFeatures: OrganizationFeaturesData
}

/**
 * FeaturesProvider hydrates the React Query cache with server-fetched feature data.
 *
 * This provides:
 * 1. Immediate access to features via useFeatures() hook with no loading state
 * 2. Context for quick synchronous feature checks via hasFeature()
 * 3. Automatic cache population for useOrganizationFeatures() queries
 *
 * Usage:
 * ```tsx
 * // In a server component
 * const features = await getOrganizationFeatures(organizationId)
 *
 * // Pass to client
 * <FeaturesProvider organizationId={orgId} initialFeatures={features}>
 *   {children}
 * </FeaturesProvider>
 * ```
 */
export function FeaturesProvider({
  children,
  organizationId,
  initialFeatures,
}: FeaturesProviderProps) {
  const queryClient = useQueryClient()

  // Hydrate React Query cache with SSR data
  queryClient.setQueryData(featuresKeys.organization(organizationId), initialFeatures)

  const hasFeature = (feature: Feature) => initialFeatures.enabledFeatures.includes(feature)

  return (
    <FeaturesContext.Provider
      value={{
        organizationId,
        edition: initialFeatures.edition,
        tier: initialFeatures.tier,
        enabledFeatures: initialFeatures.enabledFeatures,
        hasFeature,
        limits: initialFeatures.limits,
      }}
    >
      {children}
    </FeaturesContext.Provider>
  )
}

/**
 * Hook to access features from context.
 * Must be used within a FeaturesProvider.
 *
 * Provides synchronous access to feature data without loading states.
 */
export function useFeatures(): FeaturesContextValue {
  const context = useContext(FeaturesContext)
  if (!context) {
    throw new Error('useFeatures must be used within a FeaturesProvider')
  }
  return context
}

// Re-export Feature for convenience
export { Feature }
