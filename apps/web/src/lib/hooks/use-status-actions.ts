import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchStatuses,
  createStatusFn,
  updateStatusFn,
  deleteStatusFn,
  reorderStatusesFn,
  type CreateStatusInput,
  type UpdateStatusInput,
  type DeleteStatusInput,
  type ReorderStatusesInput,
} from '@/lib/server-functions/statuses'
import type { PostStatusEntity } from '@/lib/db-types'
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
      return await fetchStatuses()
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new status.
 */
export function useCreateStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateStatusInput) => createStatusFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: statusKeys.lists() })
      const previous = queryClient.getQueryData<PostStatusEntity[]>(statusKeys.lists())

      // Optimistic update
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
      queryClient.setQueryData<PostStatusEntity[]>(statusKeys.lists(), (old) =>
        old ? [...old, optimisticStatus] : [optimisticStatus]
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(statusKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKeys.lists() })
    },
  })
}

/**
 * Hook to update an existing status.
 */
export function useUpdateStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateStatusInput) => updateStatusFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: statusKeys.lists() })
      const previous = queryClient.getQueryData<PostStatusEntity[]>(statusKeys.lists())

      // Optimistic update
      queryClient.setQueryData<PostStatusEntity[]>(statusKeys.lists(), (old) =>
        old?.map((status) => {
          if (status.id !== input.id) return status
          return {
            ...status,
            ...(input.name !== undefined && { name: input.name }),
            ...(input.color !== undefined && { color: input.color }),
            ...(input.showOnRoadmap !== undefined && { showOnRoadmap: input.showOnRoadmap }),
            ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
          }
        })
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(statusKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKeys.lists() })
    },
  })
}

/**
 * Hook to delete a status.
 */
export function useDeleteStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: DeleteStatusInput): Promise<{ id: string }> => {
      return await deleteStatusFn({ data: input })
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: statusKeys.lists() })
      const previous = queryClient.getQueryData<PostStatusEntity[]>(statusKeys.lists())

      // Optimistic update
      queryClient.setQueryData<PostStatusEntity[]>(statusKeys.lists(), (old) =>
        old?.filter((status) => status.id !== input.id)
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(statusKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKeys.lists() })
    },
  })
}

/**
 * Hook to reorder statuses.
 */
export function useReorderStatuses() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ReorderStatusesInput): Promise<void> => {
      await reorderStatusesFn({ data: input })
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: statusKeys.lists() })
      const previous = queryClient.getQueryData<PostStatusEntity[]>(statusKeys.lists())

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

        queryClient.setQueryData(statusKeys.lists(), [...reordered, ...remaining])
      }

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(statusKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKeys.lists() })
    },
  })
}
