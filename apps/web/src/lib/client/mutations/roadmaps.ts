/**
 * Roadmap mutations
 *
 * Mutation hooks for roadmap CRUD operations.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Roadmap } from '@/lib/db-types'
import type { RoadmapId } from '@quackback/ids'
import {
  createRoadmapFn,
  updateRoadmapFn,
  deleteRoadmapFn,
  reorderRoadmapsFn,
} from '@/lib/server/functions/roadmaps'
import { roadmapsKeys } from '@/lib/client/hooks/use-roadmaps-query'

// ============================================================================
// Types
// ============================================================================

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
