'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Feature, type PricingTier } from '@quackback/domain/features'
import { featuresKeys, type WorkspaceFeaturesData } from '@/lib/hooks/use-features'
import type { WorkspaceId } from '@quackback/ids'

interface FeaturesContextValue {
  workspaceId: WorkspaceId
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
  workspaceId: WorkspaceId
  /** SSR-fetched features data for hydration */
  initialFeatures: WorkspaceFeaturesData
}

/**
 * FeaturesProvider hydrates the React Query cache with server-fetched feature data.
 *
 * This provides:
 * 1. Immediate access to features via useFeatures() hook with no loading state
 * 2. Context for quick synchronous feature checks via hasFeature()
 * 3. Automatic cache population for useWorkspaceFeatures() queries
 *
 * Usage:
 * ```tsx
 * // In a server component
 * const features = await getWorkspaceFeatures(workspaceId)
 *
 * // Pass to client
 * <FeaturesProvider workspaceId={orgId} initialFeatures={features}>
 *   {children}
 * </FeaturesProvider>
 * ```
 */
export function FeaturesProvider({
  children,
  workspaceId,
  initialFeatures,
}: FeaturesProviderProps) {
  const queryClient = useQueryClient()

  // Hydrate React Query cache with SSR data
  queryClient.setQueryData(featuresKeys.organization(workspaceId), initialFeatures)

  const hasFeature = (feature: Feature) => initialFeatures.enabledFeatures.includes(feature)

  return (
    <FeaturesContext.Provider
      value={{
        workspaceId,
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
