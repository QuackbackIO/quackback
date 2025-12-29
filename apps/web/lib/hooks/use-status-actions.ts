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
import type { StatusId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const statusKeys = {
  all: ['statuses'] as const,
  lists: () => [...statusKeys.all, 'list'] as const,
  detail: (id: StatusId) => [...statusKeys.all, 'detail', id] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseStatusesOptions {
  enabled?: boolean
}

/**
 * Hook to list all statuses.
 */
export function useStatuses({ enabled = true }: UseStatusesOptions = {}) {
  return useQuery({
    queryKey: statusKeys.lists(),
    queryFn: async () => {
      const result = await listStatusesAction()
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
  onSuccess?: (status: PostStatusEntity) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new status.
 *
 * @example
 * const createStatus = useCreateStatus({
 *   onSuccess: (status) => toast.success(`Created "${status.name}"`),
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * createStatus.mutate({
 *   name: 'In Progress',
 *   slug: 'in_progress',
 *   color: '#3b82f6',
 *   category: 'active',
 * })
 */
export function useCreateStatus({ onSuccess, onError }: UseCreateStatusOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.lists()

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
  onSuccess?: (status: PostStatusEntity) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update an existing status.
 *
 * @example
 * const updateStatus = useUpdateStatus({
 *   onSuccess: (status) => toast.success(`Updated "${status.name}"`),
 * })
 *
 * updateStatus.mutate({ id: status.id, name: 'New Name' })
 */
export function useUpdateStatus({ onSuccess, onError }: UseUpdateStatusOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.lists()

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
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a status.
 *
 * @example
 * const deleteStatus = useDeleteStatus({
 *   onSuccess: () => toast.success('Status deleted'),
 * })
 *
 * deleteStatus.mutate({ id: status.id })
 */
export function useDeleteStatus({ onSuccess, onError }: UseDeleteStatusOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.lists()

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
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to reorder statuses.
 *
 * @example
 * const reorderStatuses = useReorderStatuses({
 *   onSuccess: () => toast.success('Statuses reordered'),
 * })
 *
 * reorderStatuses.mutate({ statusIds: ['status_1', 'status_2', 'status_3'] })
 */
export function useReorderStatuses({ onSuccess, onError }: UseReorderStatusesOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = statusKeys.lists()

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
