'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Feature, type PricingTier } from '@quackback/domain/features'
import { getWorkspaceFeaturesAction } from '@/lib/actions/settings'

// ============================================================================
// Query Key Factory
// ============================================================================

export const featuresKeys = {
  all: ['features'] as const,
  organization: () => [...featuresKeys.all, 'organization'] as const,
}

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceFeaturesData {
  edition: 'oss' | 'cloud'
  tier: PricingTier | null
  enabledFeatures: Feature[]
  limits: {
    boards: number | 'unlimited'
    posts: number | 'unlimited'
    /** Included seats (owner + admin roles). Additional seats are billed per-seat. */
    seats: number | 'unlimited'
    roadmaps: number | 'unlimited'
  } | null
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Query hook to fetch organization features.
 * Uses SSR-provided initial data when available to prevent flash.
 */
export function useWorkspaceFeatures() {
  return useQuery({
    queryKey: featuresKeys.organization(),
    queryFn: async (): Promise<WorkspaceFeaturesData> => {
      const result = await getWorkspaceFeaturesAction({})
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as WorkspaceFeaturesData
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - features don't change often
  })
}

/**
 * Hook to check if a specific feature is enabled.
 * Returns { enabled, isLoading, tier, edition } for conditional rendering.
 */
export function useFeature(feature: Feature) {
  const { data, isLoading, error } = useWorkspaceFeatures()

  return {
    enabled: data?.enabledFeatures.includes(feature) ?? false,
    isLoading,
    error,
    tier: data?.tier ?? null,
    edition: data?.edition ?? 'cloud',
  }
}

/**
 * Hook to hydrate features from SSR data.
 * Call this in a client component that receives SSR features data.
 */
export function useHydrateFeatures(initialData: WorkspaceFeaturesData | null) {
  const queryClient = useQueryClient()

  // Hydrate cache if initial data is provided and not already cached
  if (initialData) {
    const existing = queryClient.getQueryData(featuresKeys.organization())
    if (!existing) {
      queryClient.setQueryData(featuresKeys.organization(), initialData)
    }
  }
}

// Re-export Feature for convenience
export { Feature }
