import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Feature,
  type Edition,
  type SelfHostedTier,
  type CloudTier,
  type TierLimits,
} from '@/lib/features'
import { getWorkspaceFeaturesFn } from '@/lib/server/functions/settings'

// ============================================================================
// Query Key Factory
// ============================================================================

export const featuresKeys = {
  all: ['features'] as const,
  workspace: () => [...featuresKeys.all, 'workspace'] as const,
}

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceFeaturesData {
  /** Deployment edition */
  edition: Edition
  /** Self-hosted tier (community) - null for cloud */
  selfHostedTier: SelfHostedTier | null
  /** Cloud subscription tier - null for self-hosted */
  cloudTier: CloudTier | null
  /** All features available to this workspace */
  enabledFeatures: Feature[]
  /** Resource limits */
  limits: TierLimits
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Query hook to fetch workspace features.
 * Uses SSR-provided initial data when available to prevent flash.
 */
export function useWorkspaceFeatures() {
  return useQuery({
    queryKey: featuresKeys.workspace(),
    queryFn: getWorkspaceFeaturesFn as () => Promise<WorkspaceFeaturesData>,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Hook to check if a specific feature is enabled.
 * Returns { enabled, isLoading, edition } for conditional rendering.
 */
export function useFeature(feature: Feature) {
  const { data, isLoading, error } = useWorkspaceFeatures()

  return {
    enabled: data?.enabledFeatures.includes(feature) ?? false,
    isLoading,
    error,
    edition: data?.edition ?? 'cloud',
    selfHostedTier: data?.selfHostedTier ?? null,
    cloudTier: data?.cloudTier ?? null,
  }
}

/**
 * Hook to check if running in cloud mode
 */
export function useIsCloud() {
  const { data, isLoading } = useWorkspaceFeatures()
  return {
    isCloud: data?.edition === 'cloud',
    isLoading,
  }
}

/**
 * Hook to check if running in self-hosted mode
 */
export function useIsSelfHosted() {
  const { data, isLoading } = useWorkspaceFeatures()
  return {
    isSelfHosted: data?.edition === 'self-hosted',
    isLoading,
  }
}

// ============================================================================
// Hydration Hook
// ============================================================================

/**
 * Hook to hydrate features from SSR data.
 * Call this in a client component that receives SSR features data.
 */
export function useHydrateFeatures(initialData: WorkspaceFeaturesData | null): void {
  const queryClient = useQueryClient()

  // Hydrate cache if initial data is provided and not already cached
  if (initialData) {
    const existing = queryClient.getQueryData(featuresKeys.workspace())
    if (!existing) {
      queryClient.setQueryData(featuresKeys.workspace(), initialData)
    }
  }
}

// Re-export Feature for convenience
export { Feature }
