'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActionMutation, createListOptimisticUpdate } from './use-action-mutation'
import {
  listStatusesAction,
  createStatusAction,
  updateStatusAction,
  deleteStatusAction,
  reorderStatusesAction,
  type CreateStatusInput,
  type UpdateStatusInput,
  type DeleteStatusInput,
  type ReorderStatusesInput,
} from '@/lib/actions/statuses'
import type { PostStatusEntity } from '@/lib/db'
import type { ActionError } from '@/lib/actions/types'
import type { StatusId, WorkspaceId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const statusKeys = {
  all: ['statuses'] as const,
  lists: () => [...statusKeys.all, 'list'] as const,
  list: (workspaceId: WorkspaceId) => [...statusKeys.lists(), workspaceId] as const,
  detail: (id: StatusId) => [...statusKeys.all, 'detail', id] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseStatusesOptions {
  workspaceId: WorkspaceId
  enabled?: boolean
}

/**
 * Hook to list all statuses for a workspace.
 */
export function useStatuses({ workspaceId, enabled = true }: UseStatusesOptions) {
  return useQuery({
    queryKey: statusKeys.list(workspaceId),
    queryFn: async () => {
      const result = await listStatusesAction({})
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface UseCreateStatusOptions {
  workspaceId: WorkspaceId
  onSuccess?: (status: PostStatusEntity) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new status.
 *
 * @example
 * const createStatus = useCreateStatus({
 *   workspaceId,
 *   onSuccess: (status) => toast.success(`Created "${status.name}"`),
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * createStatus.mutate({
 *   workspaceId,
 *   name: 'In Progress',
 *   slug: 'in_progress',
 *   color: '#3b82f6',
 *   category: 'active',
 * })
 */
export function useCreateStatus({ workspaceId, onSuccess, onError }: UseCreateStatusOptions) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.list(workspaceId)

  return useActionMutation<
    CreateStatusInput,
    PostStatusEntity,
    { previous: PostStatusEntity[] | undefined }
  >({
    action: createStatusAction,
    invalidateKeys: [statusKeys.lists()],
    onOptimisticUpdate: (input) => {
      // Create optimistic status with temp ID
      const optimisticStatus: PostStatusEntity = {
        id: `status_temp_${Date.now()}` as PostStatusEntity['id'],
        name: input.name,
        slug: input.slug,
        color: input.color,
        category: input.category,
        position: input.position ?? 0,
        showOnRoadmap: input.showOnRoadmap ?? false,
        isDefault: input.isDefault ?? false,
        createdAt: new Date(),
      }

      const helper = createListOptimisticUpdate<PostStatusEntity>(queryClient, listKey)
      const previous = helper.add(optimisticStatus)
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess,
    onError,
  })
}

interface UseUpdateStatusOptions {
  workspaceId: WorkspaceId
  onSuccess?: (status: PostStatusEntity) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update an existing status.
 *
 * @example
 * const updateStatus = useUpdateStatus({
 *   workspaceId,
 *   onSuccess: (status) => toast.success(`Updated "${status.name}"`),
 * })
 *
 * updateStatus.mutate({ workspaceId, id: status.id, name: 'New Name' })
 */
export function useUpdateStatus({ workspaceId, onSuccess, onError }: UseUpdateStatusOptions) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.list(workspaceId)

  return useActionMutation<
    UpdateStatusInput,
    PostStatusEntity,
    { previous: PostStatusEntity[] | undefined }
  >({
    action: updateStatusAction,
    invalidateKeys: [statusKeys.lists()],
    onOptimisticUpdate: (input) => {
      const helper = createListOptimisticUpdate<PostStatusEntity>(queryClient, listKey)
      const previous = helper.update(
        input.id as string,
        {
          name: input.name,
          color: input.color,
          showOnRoadmap: input.showOnRoadmap,
          isDefault: input.isDefault,
        } as Partial<PostStatusEntity>
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

interface UseDeleteStatusOptions {
  workspaceId: WorkspaceId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a status.
 *
 * @example
 * const deleteStatus = useDeleteStatus({
 *   workspaceId,
 *   onSuccess: () => toast.success('Status deleted'),
 * })
 *
 * deleteStatus.mutate({ workspaceId, id: status.id })
 */
export function useDeleteStatus({ workspaceId, onSuccess, onError }: UseDeleteStatusOptions) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.list(workspaceId)

  return useActionMutation<
    DeleteStatusInput,
    { id: string },
    { previous: PostStatusEntity[] | undefined }
  >({
    action: deleteStatusAction,
    invalidateKeys: [statusKeys.lists()],
    onOptimisticUpdate: (input) => {
      const helper = createListOptimisticUpdate<PostStatusEntity>(queryClient, listKey)
      const previous = helper.remove(input.id as string)
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess: () => onSuccess?.(),
    onError,
  })
}

interface UseReorderStatusesOptions {
  workspaceId: WorkspaceId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to reorder statuses within a workspace.
 *
 * @example
 * const reorderStatuses = useReorderStatuses({
 *   workspaceId,
 *   onSuccess: () => toast.success('Statuses reordered'),
 * })
 *
 * reorderStatuses.mutate({ workspaceId, statusIds: ['status_1', 'status_2', 'status_3'] })
 */
export function useReorderStatuses({ workspaceId, onSuccess, onError }: UseReorderStatusesOptions) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.list(workspaceId)

  return useActionMutation<
    ReorderStatusesInput,
    { success: boolean },
    { previous: PostStatusEntity[] | undefined }
  >({
    action: reorderStatusesAction,
    invalidateKeys: [statusKeys.lists()],
    onOptimisticUpdate: (input) => {
      const previous = queryClient.getQueryData<PostStatusEntity[]>(listKey)

      if (previous) {
        // Reorder based on the new statusIds order
        const statusMap = new Map(previous.map((s) => [s.id, s]))
        const reordered = input.statusIds
          .map((id, index) => {
            const status = statusMap.get(id as PostStatusEntity['id'])
            if (status) {
              return { ...status, position: index }
            }
            return null
          })
          .filter((s): s is PostStatusEntity => s !== null)

        // Add any statuses not in the reorder list at the end
        const reorderedIds = new Set(input.statusIds)
        const remaining = previous
          .filter((s) => !reorderedIds.has(s.id))
          .map((s, i) => ({ ...s, position: reordered.length + i }))

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
