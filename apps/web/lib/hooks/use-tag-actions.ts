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
import type { TagId, WorkspaceId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const tagKeys = {
  all: ['tags'] as const,
  lists: () => [...tagKeys.all, 'list'] as const,
  list: (workspaceId: WorkspaceId) => [...tagKeys.lists(), workspaceId] as const,
  detail: (id: TagId) => [...tagKeys.all, 'detail', id] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseTagsOptions {
  workspaceId: WorkspaceId
  enabled?: boolean
}

/**
 * Hook to list all tags for a workspace.
 */
export function useTags({ workspaceId, enabled = true }: UseTagsOptions) {
  return useQuery({
    queryKey: tagKeys.list(workspaceId),
    queryFn: async () => {
      const result = await listTagsAction({})
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
  workspaceId: WorkspaceId
  onSuccess?: (tag: Tag) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new tag.
 *
 * @example
 * const createTag = useCreateTag({
 *   workspaceId,
 *   onSuccess: (tag) => toast.success(`Created "${tag.name}"`),
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * createTag.mutate({ workspaceId, name: 'Bug', color: '#ef4444' })
 */
export function useCreateTag({ workspaceId, onSuccess, onError }: UseCreateTagOptions) {
  const queryClient = useQueryClient()
  const listKey = tagKeys.list(workspaceId)

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
  workspaceId: WorkspaceId
  onSuccess?: (tag: Tag) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update an existing tag.
 *
 * @example
 * const updateTag = useUpdateTag({
 *   workspaceId,
 *   onSuccess: (tag) => toast.success(`Updated "${tag.name}"`),
 * })
 *
 * updateTag.mutate({ workspaceId, id: tag.id, name: 'New Name' })
 */
export function useUpdateTag({ workspaceId, onSuccess, onError }: UseUpdateTagOptions) {
  const queryClient = useQueryClient()
  const listKey = tagKeys.list(workspaceId)

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
  workspaceId: WorkspaceId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a tag.
 *
 * @example
 * const deleteTag = useDeleteTag({
 *   workspaceId,
 *   onSuccess: () => toast.success('Tag deleted'),
 * })
 *
 * deleteTag.mutate({ workspaceId, id: tag.id })
 */
export function useDeleteTag({ workspaceId, onSuccess, onError }: UseDeleteTagOptions) {
  const queryClient = useQueryClient()
  const listKey = tagKeys.list(workspaceId)

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
