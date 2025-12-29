'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActionMutation, createListOptimisticUpdate } from './use-action-mutation'
import {
  listTagsAction,
  createTagAction,
  updateTagAction,
  deleteTagAction,
  type CreateTagInput,
  type UpdateTagInput,
  type DeleteTagInput,
} from '@/lib/actions/tags'
import type { Tag } from '@/lib/db'
import type { ActionError } from '@/lib/actions/types'
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
// Query Hooks
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
    queryFn: async () => {
      const result = await listTagsAction()
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

interface UseCreateTagOptions {
  onSuccess?: (tag: Tag) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new tag.
 *
 * @example
 * const createTag = useCreateTag({
 *   onSuccess: (tag) => toast.success(`Created "${tag.name}"`),
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * createTag.mutate({ name: 'Bug', color: '#ef4444' })
 */
export function useCreateTag({ onSuccess, onError }: UseCreateTagOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = tagKeys.lists()

  return useActionMutation<CreateTagInput, Tag, { previous: Tag[] | undefined }>({
    action: createTagAction,
    invalidateKeys: [tagKeys.lists()],
    onOptimisticUpdate: (input) => {
      // Create optimistic tag with temp ID
      const optimisticTag: Tag = {
        id: `tag_temp_${Date.now()}` as Tag['id'],
        name: input.name,
        color: input.color || '#6b7280',
        createdAt: new Date(),
      }

      const helper = createListOptimisticUpdate<Tag>(queryClient, listKey)
      const previous = helper.add(optimisticTag)
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess,
    onError,
  })
}

interface UseUpdateTagOptions {
  onSuccess?: (tag: Tag) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update an existing tag.
 *
 * @example
 * const updateTag = useUpdateTag({
 *   onSuccess: (tag) => toast.success(`Updated "${tag.name}"`),
 * })
 *
 * updateTag.mutate({ id: tag.id, name: 'New Name' })
 */
export function useUpdateTag({ onSuccess, onError }: UseUpdateTagOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = tagKeys.lists()

  return useActionMutation<UpdateTagInput, Tag, { previous: Tag[] | undefined }>({
    action: updateTagAction,
    invalidateKeys: [tagKeys.lists()],
    onOptimisticUpdate: (input) => {
      const helper = createListOptimisticUpdate<Tag>(queryClient, listKey)
      const previous = helper.update(
        input.id as string,
        {
          name: input.name,
          color: input.color,
        } as Partial<Tag>
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

interface UseDeleteTagOptions {
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a tag.
 *
 * @example
 * const deleteTag = useDeleteTag({
 *   onSuccess: () => toast.success('Tag deleted'),
 * })
 *
 * deleteTag.mutate({ id: tag.id })
 */
export function useDeleteTag({ onSuccess, onError }: UseDeleteTagOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = tagKeys.lists()

  return useActionMutation<DeleteTagInput, { id: string }, { previous: Tag[] | undefined }>({
    action: deleteTagAction,
    invalidateKeys: [tagKeys.lists()],
    onOptimisticUpdate: (input) => {
      const helper = createListOptimisticUpdate<Tag>(queryClient, listKey)
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
