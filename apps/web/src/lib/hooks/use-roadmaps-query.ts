/**
 * Roadmap query hooks
 *
 * Query hooks for fetching roadmap data.
 * Mutations are in @/lib/mutations/roadmaps.
 */

import { useQuery } from '@tanstack/react-query'
import type { Roadmap } from '@/lib/db-types'
import type { RoadmapId } from '@quackback/ids'
import { fetchRoadmaps } from '@/lib/server-functions/roadmaps'
import { listPublicRoadmapsFn } from '@/lib/server-functions/public-posts'

// ============================================================================
// Types
// ============================================================================

/** Roadmap type for client components (Date fields may be strings after serialization) */
export interface RoadmapView {
  id: RoadmapId
  name: string
  description: string | null
  slug: string
  isPublic: boolean
  position: number
  createdAt: Date | string
  updatedAt: Date | string
}

interface UseRoadmapsOptions {
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapsKeys = {
  all: ['roadmaps'] as const,
  list: () => [...roadmapsKeys.all, 'list'] as const,
  publicList: () => [...roadmapsKeys.all, 'public'] as const,
  detail: (roadmapId: RoadmapId) => [...roadmapsKeys.all, 'detail', roadmapId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to fetch all roadmaps (admin)
 */
export function useRoadmaps({ enabled = true }: UseRoadmapsOptions = {}) {
  return useQuery({
    queryKey: roadmapsKeys.list(),
    queryFn: fetchRoadmaps as unknown as () => Promise<Roadmap[]>,
    enabled,
  })
}

/**
 * Hook to fetch public roadmaps (portal)
 */
export function usePublicRoadmaps({ enabled = true }: UseRoadmapsOptions = {}) {
  return useQuery({
    queryKey: roadmapsKeys.publicList(),
    queryFn: listPublicRoadmapsFn as () => Promise<RoadmapView[]>,
    enabled,
  })
}
