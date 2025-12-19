'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActionMutation, createListOptimisticUpdate } from './use-action-mutation'
import {
  listRoadmapsAction,
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
import type { Roadmap } from '@/lib/db/types'
import type { ActionError } from '@/lib/actions/types'
import type { WorkspaceId, RoadmapId, StatusId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const roadmapKeys = {
  all: ['roadmaps'] as const,
  lists: () => [...roadmapKeys.all, 'list'] as const,
  list: (workspaceId: WorkspaceId) => [...roadmapKeys.lists(), workspaceId] as const,
  detail: (id: RoadmapId) => [...roadmapKeys.all, 'detail', id] as const,
  posts: (roadmapId: RoadmapId) => [...roadmapKeys.all, 'posts', roadmapId] as const,
  postsFiltered: (roadmapId: RoadmapId, statusId?: StatusId) =>
    [...roadmapKeys.posts(roadmapId), { statusId }] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseRoadmapsOptions {
  workspaceId: WorkspaceId
  enabled?: boolean
}

/**
 * Hook to list all roadmaps for a workspace.
 */
export function useRoadmaps({ workspaceId, enabled = true }: UseRoadmapsOptions) {
  return useQuery({
    queryKey: roadmapKeys.list(workspaceId),
    queryFn: async () => {
      const result = await listRoadmapsAction({ workspaceId })
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
  workspaceId: WorkspaceId
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
  workspaceId,
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
        workspaceId,
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

interface UseCreateRoadmapOptions {
  workspaceId: WorkspaceId
  onSuccess?: (roadmap: Roadmap) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new roadmap.
 */
export function useCreateRoadmap({ workspaceId, onSuccess, onError }: UseCreateRoadmapOptions) {
  const queryClient = useQueryClient()
  const listKey = roadmapKeys.list(workspaceId)

  return useActionMutation<CreateRoadmapInput, Roadmap, { previous: Roadmap[] | undefined }>({
    action: createRoadmapAction,
    invalidateKeys: [roadmapKeys.lists()],
    onOptimisticUpdate: (input) => {
      const optimisticRoadmap: Roadmap = {
        id: `roadmap_temp_${Date.now()}` as Roadmap['id'],
        workspaceId: input.workspaceId as Roadmap['workspaceId'],
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        isPublic: input.isPublic ?? true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const helper = createListOptimisticUpdate<Roadmap>(queryClient, listKey)
      const previous = helper.add(optimisticRoadmap)
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess,
    onError,
  })
}

interface UseUpdateRoadmapOptions {
  workspaceId: WorkspaceId
  onSuccess?: (roadmap: Roadmap) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update an existing roadmap.
 */
export function useUpdateRoadmap({ workspaceId, onSuccess, onError }: UseUpdateRoadmapOptions) {
  const queryClient = useQueryClient()
  const listKey = roadmapKeys.list(workspaceId)

  return useActionMutation<UpdateRoadmapInput, Roadmap, { previous: Roadmap[] | undefined }>({
    action: updateRoadmapAction,
    invalidateKeys: [roadmapKeys.lists()],
    onOptimisticUpdate: (input) => {
      const helper = createListOptimisticUpdate<Roadmap>(queryClient, listKey)
      const previous = helper.update(
        input.id as string,
        {
          name: input.name,
          description: input.description,
          isPublic: input.isPublic,
          updatedAt: new Date(),
        } as Partial<Roadmap>
      )
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess,
    onError,
  })
}

interface UseDeleteRoadmapOptions {
  workspaceId: WorkspaceId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a roadmap.
 */
export function useDeleteRoadmap({ workspaceId, onSuccess, onError }: UseDeleteRoadmapOptions) {
  const queryClient = useQueryClient()
  const listKey = roadmapKeys.list(workspaceId)

  return useActionMutation<DeleteRoadmapInput, { id: string }, { previous: Roadmap[] | undefined }>(
    {
      action: deleteRoadmapAction,
      invalidateKeys: [roadmapKeys.lists()],
      onOptimisticUpdate: (input) => {
        const helper = createListOptimisticUpdate<Roadmap>(queryClient, listKey)
        const previous = helper.remove(input.id as string)
        return { previous }
      },
      onRollback: ({ previous }) => {
        queryClient.setQueryData(listKey, previous)
      },
      onSuccess: () => onSuccess?.(),
      onError,
    }
  )
}

interface UseReorderRoadmapsOptions {
  workspaceId: WorkspaceId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to reorder roadmaps.
 */
export function useReorderRoadmaps({ workspaceId, onSuccess, onError }: UseReorderRoadmapsOptions) {
  const queryClient = useQueryClient()
  const listKey = roadmapKeys.list(workspaceId)

  return useActionMutation<
    ReorderRoadmapsInput,
    { success: boolean },
    { previous: Roadmap[] | undefined }
  >({
    action: reorderRoadmapsAction,
    invalidateKeys: [roadmapKeys.lists()],
    onOptimisticUpdate: (input) => {
      const previous = queryClient.getQueryData<Roadmap[]>(listKey)

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

        queryClient.setQueryData(listKey, [...reordered, ...remaining])
      }

      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess: () => onSuccess?.(),
    onError,
  })
}

interface UseAddPostToRoadmapOptions {
  roadmapId: RoadmapId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to add a post to a roadmap.
 */
export function useAddPostToRoadmap({ roadmapId, onSuccess, onError }: UseAddPostToRoadmapOptions) {
  return useActionMutation<AddPostToRoadmapInput, { added: boolean }>({
    action: addPostToRoadmapAction,
    invalidateKeys: [roadmapKeys.posts(roadmapId)],
    onSuccess: () => onSuccess?.(),
    onError,
  })
}

interface UseRemovePostFromRoadmapOptions {
  roadmapId: RoadmapId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to remove a post from a roadmap.
 */
export function useRemovePostFromRoadmap({
  roadmapId,
  onSuccess,
  onError,
}: UseRemovePostFromRoadmapOptions) {
  return useActionMutation<RemovePostFromRoadmapInput, { removed: boolean }>({
    action: removePostFromRoadmapAction,
    invalidateKeys: [roadmapKeys.posts(roadmapId)],
    onSuccess: () => onSuccess?.(),
    onError,
  })
}

interface UseReorderRoadmapPostsOptions {
  roadmapId: RoadmapId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to reorder posts within a roadmap.
 */
export function useReorderRoadmapPosts({
  roadmapId,
  onSuccess,
  onError,
}: UseReorderRoadmapPostsOptions) {
  return useActionMutation<ReorderRoadmapPostsInput, { success: boolean }>({
    action: reorderRoadmapPostsAction,
    invalidateKeys: [roadmapKeys.posts(roadmapId)],
    onSuccess: () => onSuccess?.(),
    onError,
  })
}
