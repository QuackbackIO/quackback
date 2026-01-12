import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchTags,
  createTagFn,
  updateTagFn,
  deleteTagFn,
  type CreateTagInput,
  type UpdateTagInput,
  type DeleteTagInput,
} from '@/lib/server-functions/tags'
import type { Tag } from '@/lib/db-types'
import type { TagId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const tagKeys = {
  all: ['tags'] as const,
  lists: () => [...tagKeys.all, 'list'] as const,
  detail: (id: TagId) => [...tagKeys.all, 'detail', id] as const,
}

// ============================================================================
// Query Hook
// ============================================================================

interface UseTagsOptions {
  enabled?: boolean
}

/**
 * Hook to list all tags.
 */
export function useTags({ enabled = true }: UseTagsOptions = {}) {
  return useQuery({
    queryKey: tagKeys.lists(),
    queryFn: fetchTags,
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new tag.
 */
export function useCreateTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateTagInput) => createTagFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: tagKeys.lists() })
      const previous = queryClient.getQueryData<Tag[]>(tagKeys.lists())

      const optimisticTag: Tag = {
        id: `tag_temp_${Date.now()}` as Tag['id'],
        name: input.name,
        color: input.color || '#6b7280',
        createdAt: new Date(),
      }
      queryClient.setQueryData<Tag[]>(tagKeys.lists(), (old) =>
        old ? [...old, optimisticTag] : [optimisticTag]
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tagKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() })
    },
  })
}

/**
 * Hook to update an existing tag.
 */
export function useUpdateTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateTagInput) => updateTagFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: tagKeys.lists() })
      const previous = queryClient.getQueryData<Tag[]>(tagKeys.lists())

      queryClient.setQueryData<Tag[]>(tagKeys.lists(), (old) =>
        old?.map((tag) =>
          tag.id === input.id
            ? { ...tag, name: input.name ?? tag.name, color: input.color ?? tag.color }
            : tag
        )
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tagKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() })
    },
  })
}

/**
 * Hook to delete a tag.
 */
export function useDeleteTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: DeleteTagInput) => deleteTagFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: tagKeys.lists() })
      const previous = queryClient.getQueryData<Tag[]>(tagKeys.lists())

      queryClient.setQueryData<Tag[]>(tagKeys.lists(), (old) =>
        old?.filter((tag) => tag.id !== input.id)
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tagKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() })
    },
  })
}
