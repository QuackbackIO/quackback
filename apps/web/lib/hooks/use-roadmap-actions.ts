'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listRoadmapsAction,
  getRoadmapAction,
  createRoadmapAction,
  updateRoadmapAction,
  deleteRoadmapAction,
  reorderRoadmapsAction,
  getRoadmapPostsAction,
  addPostToRoadmapAction,
  removePostFromRoadmapAction,
  reorderRoadmapPostsAction,
  type CreateRoadmapInput,
  type UpdateRoadmapInput,
  type DeleteRoadmapInput,
  type ReorderRoadmapsInput,
  type AddPostToRoadmapInput,
  type RemovePostFromRoadmapInput,
  type ReorderRoadmapPostsInput,
} from '@/lib/actions/roadmaps'
import type { Roadmap } from '@/lib/db'
import type { RoadmapId, StatusId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapKeys = {
  all: ['roadmaps'] as const,
  lists: () => [...roadmapKeys.all, 'list'] as const,
  detail: (id: RoadmapId) => [...roadmapKeys.all, 'detail', id] as const,
  posts: (roadmapId: RoadmapId) => [...roadmapKeys.all, 'posts', roadmapId] as const,
  postsFiltered: (roadmapId: RoadmapId, statusId?: StatusId) =>
    [...roadmapKeys.posts(roadmapId), { statusId }] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseRoadmapsOptions {
  enabled?: boolean
}

/**
 * Hook to list all roadmaps.
 */
export function useRoadmaps({ enabled = true }: UseRoadmapsOptions = {}) {
  return useQuery({
    queryKey: roadmapKeys.lists(),
    queryFn: async () => {
      const result = await listRoadmapsAction()
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

interface UseRoadmapDetailOptions {
  roadmapId: RoadmapId
  enabled?: boolean
}

/**
 * Hook to get a single roadmap by ID.
 */
export function useRoadmapDetail({ roadmapId, enabled = true }: UseRoadmapDetailOptions) {
  return useQuery({
    queryKey: roadmapKeys.detail(roadmapId),
    queryFn: async () => {
      const result = await getRoadmapAction({ id: roadmapId })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

interface UseRoadmapPostsOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  limit?: number
  offset?: number
  enabled?: boolean
}

/**
 * Hook to get posts for a roadmap, optionally filtered by status.
 */
export function useRoadmapPosts({
  roadmapId,
  statusId,
  limit = 20,
  offset = 0,
  enabled = true,
}: UseRoadmapPostsOptions) {
  return useQuery({
    queryKey: roadmapKeys.postsFiltered(roadmapId, statusId),
    queryFn: async () => {
      const result = await getRoadmapPostsAction({
        roadmapId,
        statusId,
        limit,
        offset,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new roadmap.
 */
export function useCreateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRoadmapInput): Promise<Roadmap> => {
      const result = await createRoadmapAction(input)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: roadmapKeys.lists() })
      const previous = queryClient.getQueryData<Roadmap[]>(roadmapKeys.lists())

      // Optimistic update
      const optimisticRoadmap: Roadmap = {
        id: `roadmap_temp_${Date.now()}` as Roadmap['id'],
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        isPublic: input.isPublic ?? true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      queryClient.setQueryData<Roadmap[]>(roadmapKeys.lists(), (old) =>
        old ? [...old, optimisticRoadmap] : [optimisticRoadmap]
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(roadmapKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: roadmapKeys.lists() })
    },
  })
}

/**
 * Hook to update an existing roadmap.
 */
export function useUpdateRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateRoadmapInput): Promise<Roadmap> => {
      const result = await updateRoadmapAction(input)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: roadmapKeys.lists() })
      await queryClient.cancelQueries({ queryKey: roadmapKeys.detail(input.id) })
      const previousList = queryClient.getQueryData<Roadmap[]>(roadmapKeys.lists())
      const previousDetail = queryClient.getQueryData<Roadmap>(roadmapKeys.detail(input.id))

      // Optimistic update for list
      queryClient.setQueryData<Roadmap[]>(roadmapKeys.lists(), (old) =>
        old?.map((roadmap) => {
          if (roadmap.id !== input.id) return roadmap
          return {
            ...roadmap,
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
            updatedAt: new Date(),
          }
        })
      )

      // Optimistic update for detail
      if (previousDetail) {
        queryClient.setQueryData<Roadmap>(roadmapKeys.detail(input.id), {
          ...previousDetail,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
          updatedAt: new Date(),
        })
      }

      return { previousList, previousDetail }
    },
    onError: (_err, input, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(roadmapKeys.lists(), context.previousList)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(roadmapKeys.detail(input.id), context.previousDetail)
      }
    },
    onSettled: (_data, _error, input) => {
      queryClient.invalidateQueries({ queryKey: roadmapKeys.lists() })
      queryClient.invalidateQueries({ queryKey: roadmapKeys.detail(input.id) })
    },
  })
}

/**
 * Hook to delete a roadmap.
 */
export function useDeleteRoadmap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: DeleteRoadmapInput): Promise<{ id: string }> => {
      const result = await deleteRoadmapAction(input)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: roadmapKeys.lists() })
      await queryClient.cancelQueries({ queryKey: roadmapKeys.detail(input.id) })
      const previous = queryClient.getQueryData<Roadmap[]>(roadmapKeys.lists())

      // Optimistic update
      queryClient.setQueryData<Roadmap[]>(roadmapKeys.lists(), (old) =>
        old?.filter((roadmap) => roadmap.id !== input.id)
      )

      // Remove detail from cache
      queryClient.removeQueries({ queryKey: roadmapKeys.detail(input.id) })

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(roadmapKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: roadmapKeys.lists() })
    },
  })
}

/**
 * Hook to reorder roadmaps.
 */
export function useReorderRoadmaps() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ReorderRoadmapsInput): Promise<{ success: boolean }> => {
      const result = await reorderRoadmapsAction(input)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: roadmapKeys.lists() })
      const previous = queryClient.getQueryData<Roadmap[]>(roadmapKeys.lists())

      if (previous) {
        const roadmapMap = new Map(previous.map((r) => [r.id, r]))
        const reordered = input.roadmapIds
          .map((id, index) => {
            const roadmap = roadmapMap.get(id as Roadmap['id'])
            if (roadmap) {
              return { ...roadmap, position: index }
            }
            return null
          })
          .filter((r): r is Roadmap => r !== null)

        const reorderedIds = new Set(input.roadmapIds)
        const remaining = previous
          .filter((r) => !reorderedIds.has(r.id))
          .map((r, i) => ({ ...r, position: reordered.length + i }))

        queryClient.setQueryData(roadmapKeys.lists(), [...reordered, ...remaining])
      }

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(roadmapKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: roadmapKeys.lists() })
    },
  })
}

/**
 * Hook to add a post to a roadmap.
 */
export function useAddPostToRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AddPostToRoadmapInput): Promise<{ added: boolean }> => {
      const result = await addPostToRoadmapAction(input)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: roadmapKeys.posts(roadmapId) })
    },
  })
}

/**
 * Hook to remove a post from a roadmap.
 */
export function useRemovePostFromRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RemovePostFromRoadmapInput): Promise<{ removed: boolean }> => {
      const result = await removePostFromRoadmapAction(input)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: roadmapKeys.posts(roadmapId) })
    },
  })
}

/**
 * Hook to reorder posts within a roadmap.
 */
export function useReorderRoadmapPosts(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ReorderRoadmapPostsInput): Promise<{ success: boolean }> => {
      const result = await reorderRoadmapPostsAction(input)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: roadmapKeys.posts(roadmapId) })
    },
  })
}
