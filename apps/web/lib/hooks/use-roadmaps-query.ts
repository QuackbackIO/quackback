'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Roadmap } from '@/lib/db/types'
import type { WorkspaceId, RoadmapId } from '@quackback/ids'
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
  list: (workspaceId: WorkspaceId) => [...roadmapsKeys.all, 'list', workspaceId] as const,
  publicList: (workspaceId: WorkspaceId) => [...roadmapsKeys.all, 'public', workspaceId] as const,
  detail: (roadmapId: RoadmapId) => [...roadmapsKeys.all, 'detail', roadmapId] as const,
}

interface UseRoadmapsOptions {
  workspaceId: WorkspaceId
  enabled?: boolean
}

/**
 * Hook to fetch all roadmaps for an organization (admin)
 */
export function useRoadmaps({ workspaceId, enabled = true }: UseRoadmapsOptions) {
  return useQuery({
    queryKey: roadmapsKeys.list(workspaceId),
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
 * Hook to fetch public roadmaps for an organization (portal)
 */
export function usePublicRoadmaps({ workspaceId, enabled = true }: UseRoadmapsOptions) {
  return useQuery({
    queryKey: roadmapsKeys.publicList(workspaceId),
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
export function useCreateRoadmap(workspaceId: WorkspaceId) {
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
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
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
export function useUpdateRoadmap(workspaceId: WorkspaceId) {
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
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
    },
  })
}

/**
 * Hook to delete a roadmap
 */
export function useDeleteRoadmap(workspaceId: WorkspaceId) {
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
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
    },
  })
}

/**
 * Hook to reorder roadmaps
 */
export function useReorderRoadmaps(workspaceId: WorkspaceId) {
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
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
    },
  })
}
