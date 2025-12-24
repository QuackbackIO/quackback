'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Roadmap } from '@/lib/db'
import type { RoadmapId } from '@quackback/ids'
import {
  listRoadmapsAction,
  createRoadmapAction,
  updateRoadmapAction,
  deleteRoadmapAction,
  reorderRoadmapsAction,
} from '@/lib/actions/roadmaps'
import { listPublicRoadmapsAction } from '@/lib/actions/public-posts'

export const roadmapsKeys = {
  all: ['roadmaps'] as const,
  list: () => [...roadmapsKeys.all, 'list'] as const,
  publicList: () => [...roadmapsKeys.all, 'public'] as const,
  detail: (roadmapId: RoadmapId) => [...roadmapsKeys.all, 'detail', roadmapId] as const,
}

interface UseRoadmapsOptions {
  enabled?: boolean
}

/**
 * Hook to fetch all roadmaps (admin)
 */
export function useRoadmaps({ enabled = true }: UseRoadmapsOptions = {}) {
  return useQuery({
    queryKey: roadmapsKeys.list(),
    queryFn: async (): Promise<Roadmap[]> => {
      const result = await listRoadmapsAction({})
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as Roadmap[]
    },
    enabled,
  })
}

/**
 * Hook to fetch public roadmaps (portal)
 */
export function usePublicRoadmaps({ enabled = true }: UseRoadmapsOptions = {}) {
  return useQuery({
    queryKey: roadmapsKeys.publicList(),
    queryFn: async (): Promise<Roadmap[]> => {
      const result = await listPublicRoadmapsAction({})
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as Roadmap[]
    },
    enabled,
  })
}

interface CreateRoadmapInput {
  name: string
  slug: string
  description?: string
  isPublic?: boolean
}

/**
 * Hook to create a new roadmap
 */
export function useCreateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRoadmapInput): Promise<Roadmap> => {
      const result = await createRoadmapAction({
        name: input.name,
        slug: input.slug,
        description: input.description,
        isPublic: input.isPublic,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as Roadmap
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}

interface UpdateRoadmapInput {
  name?: string
  description?: string
  isPublic?: boolean
}

/**
 * Hook to update a roadmap
 */
export function useUpdateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      roadmapId,
      input,
    }: {
      roadmapId: RoadmapId
      input: UpdateRoadmapInput
    }): Promise<Roadmap> => {
      const result = await updateRoadmapAction({
        id: roadmapId,
        name: input.name,
        description: input.description,
        isPublic: input.isPublic,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as Roadmap
    },
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
    mutationFn: async (roadmapId: RoadmapId): Promise<void> => {
      const result = await deleteRoadmapAction({
        id: roadmapId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
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
    mutationFn: async (roadmapIds: string[]): Promise<void> => {
      const result = await reorderRoadmapsAction({
        roadmapIds,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}
