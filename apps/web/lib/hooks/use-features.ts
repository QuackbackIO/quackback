'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Feature, type PricingTier } from '@quackback/domain/features'

// ============================================================================
// Query Key Factory
// ============================================================================

export const featuresKeys = {
  all: ['features'] as const,
  organization: (workspaceId: string) => [...featuresKeys.all, workspaceId] as const,
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
    teamMembers: number | 'unlimited'
    apiRequests: number | 'unlimited'
  } | null
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Query hook to fetch organization features.
 * Uses SSR-provided initial data when available to prevent flash.
 */
export function useWorkspaceFeatures(workspaceId: string) {
  return useQuery({
    queryKey: featuresKeys.organization(workspaceId),
    queryFn: async (): Promise<WorkspaceFeaturesData> => {
      const response = await fetch(`/api/workspace/features?workspaceId=${workspaceId}`)
      if (!response.ok) throw new Error('Failed to fetch features')
      return response.json()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - features don't change often
  })
}

/**
 * Hook to check if a specific feature is enabled.
 * Returns { enabled, isLoading, tier, edition } for conditional rendering.
 */
export function useFeature(workspaceId: string, feature: Feature) {
  const { data, isLoading, error } = useWorkspaceFeatures(workspaceId)

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
export function useHydrateFeatures(workspaceId: string, initialData: WorkspaceFeaturesData | null) {
  const queryClient = useQueryClient()

  // Hydrate cache if initial data is provided and not already cached
  if (initialData) {
    const existing = queryClient.getQueryData(featuresKeys.organization(workspaceId))
    if (!existing) {
      queryClient.setQueryData(featuresKeys.organization(workspaceId), initialData)
    }
  }
}

// Re-export Feature for convenience
export { Feature }
