'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Feature, type PricingTier } from '@quackback/domain/features'

// ============================================================================
// Query Key Factory
// ============================================================================

export const featuresKeys = {
  all: ['features'] as const,
  organization: (organizationId: string) => [...featuresKeys.all, organizationId] as const,
}

// ============================================================================
// Types
// ============================================================================

export interface OrganizationFeaturesData {
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
export function useOrganizationFeatures(organizationId: string) {
  return useQuery({
    queryKey: featuresKeys.organization(organizationId),
    queryFn: async (): Promise<OrganizationFeaturesData> => {
      const response = await fetch(`/api/organization/features?organizationId=${organizationId}`)
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
export function useFeature(organizationId: string, feature: Feature) {
  const { data, isLoading, error } = useOrganizationFeatures(organizationId)

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
export function useHydrateFeatures(
  organizationId: string,
  initialData: OrganizationFeaturesData | null
) {
  const queryClient = useQueryClient()

  // Hydrate cache if initial data is provided and not already cached
  if (initialData) {
    const existing = queryClient.getQueryData(featuresKeys.organization(organizationId))
    if (!existing) {
      queryClient.setQueryData(featuresKeys.organization(organizationId), initialData)
    }
  }
}

// Re-export Feature for convenience
export { Feature }
