import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Roadmap } from '@/lib/db-types'
import type { RoadmapId } from '@quackback/ids'
import {
  fetchRoadmaps,
  createRoadmapFn,
  updateRoadmapFn,
  deleteRoadmapFn,
  reorderRoadmapsFn,
} from '@/lib/server-functions/roadmaps'
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

interface CreateRoadmapInput {
  name: string
  slug: string
  description?: string
  isPublic?: boolean
}

interface UpdateRoadmapInput {
  name?: string
  description?: string
  isPublic?: boolean
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

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new roadmap
 */
export function useCreateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateRoadmapInput) =>
      createRoadmapFn({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          isPublic: input.isPublic,
        },
      }) as unknown as Promise<Roadmap>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

/**
 * Hook to update a roadmap
 */
export function useUpdateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ roadmapId, input }: { roadmapId: RoadmapId; input: UpdateRoadmapInput }) =>
      updateRoadmapFn({
        data: {
          id: roadmapId,
          name: input.name,
          description: input.description,
          isPublic: input.isPublic,
        },
      }) as unknown as Promise<Roadmap>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

/**
 * Hook to delete a roadmap
 */
export function useDeleteRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roadmapId: RoadmapId) => deleteRoadmapFn({ data: { id: roadmapId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

/**
 * Hook to reorder roadmaps
 */
export function useReorderRoadmaps() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roadmapIds: string[]) => reorderRoadmapsFn({ data: { roadmapIds } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}
