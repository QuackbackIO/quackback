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
      return (await fetchRoadmaps()) as unknown as Roadmap[]
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
    queryFn: (): Promise<Roadmap[]> => listPublicRoadmapsFn() as unknown as Promise<Roadmap[]>,
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
      return (await createRoadmapFn({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          isPublic: input.isPublic,
        },
      })) as unknown as Roadmap
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
      return (await updateRoadmapFn({
        data: {
          id: roadmapId,
          name: input.name,
          description: input.description,
          isPublic: input.isPublic,
        },
      })) as unknown as Roadmap
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
      await deleteRoadmapFn({
        data: {
          id: roadmapId,
        },
      })
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
      await reorderRoadmapsFn({
        data: {
          roadmapIds,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list() })
    },
  })
}
