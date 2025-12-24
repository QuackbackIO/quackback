'use client'

import { useQuery } from '@tanstack/react-query'
import { useActionMutation } from './use-action-mutation'
import {
  listInboxPostsAction,
  createPostAction,
  getPostWithDetailsAction,
  updatePostAction,
  deletePostAction,
  changePostStatusAction,
  updatePostTagsAction,
  restorePostAction,
  type ListInboxPostsInput,
  type CreatePostInput,
  type UpdatePostInput,
  type DeletePostInput,
  type ChangeStatusInput,
  type UpdateTagsInput,
  type RestorePostInput,
} from '@/lib/actions/posts'
import type { ActionError } from '@/lib/actions/types'
import type { PostId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const postKeys = {
  all: ['posts'] as const,
  lists: () => [...postKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...postKeys.lists(), filters] as const,
  details: () => [...postKeys.all, 'detail'] as const,
  detail: (id: PostId) => [...postKeys.details(), id] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseInboxPostsOptions {
  boardIds?: string[]
  statusIds?: string[]
  statusSlugs?: string[]
  tagIds?: string[]
  ownerId?: string | null
  search?: string
  dateFrom?: string
  dateTo?: string
  minVotes?: number
  sort?: 'newest' | 'oldest' | 'votes'
  page?: number
  limit?: number
  enabled?: boolean
}

/**
 * Hook to list inbox posts with filtering.
 */
export function useInboxPosts({
  boardIds,
  statusIds,
  statusSlugs,
  tagIds,
  ownerId,
  search,
  dateFrom,
  dateTo,
  minVotes,
  sort = 'newest',
  page = 1,
  limit = 20,
  enabled = true,
}: UseInboxPostsOptions) {
  const filters = {
    boardIds,
    statusIds,
    statusSlugs,
    tagIds,
    ownerId,
    search,
    dateFrom,
    dateTo,
    minVotes,
    sort,
    page,
    limit,
  }

  return useQuery({
    queryKey: postKeys.list(filters),
    queryFn: async () => {
      const result = await listInboxPostsAction({
        boardIds,
        statusIds,
        statusSlugs,
        tagIds,
        ownerId,
        search,
        dateFrom,
        dateTo,
        minVotes,
        sort,
        page,
        limit,
      } as ListInboxPostsInput)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    enabled,
    staleTime: 1 * 60 * 1000, // 1 minute
  })
}

interface UsePostDetailsOptions {
  postId: PostId
  enabled?: boolean
}

/**
 * Hook to get post details including comments and avatars.
 */
export function usePostDetails({ postId, enabled = true }: UsePostDetailsOptions) {
  return useQuery({
    queryKey: postKeys.detail(postId),
    queryFn: async () => {
      const result = await getPostWithDetailsAction({
        id: postId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface UseCreatePostOptions {
  onSuccess?: (post: unknown) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new post.
 */
export function useCreatePost({ onSuccess, onError }: UseCreatePostOptions = {}) {
  return useActionMutation<CreatePostInput, unknown>({
    action: createPostAction,
    invalidateKeys: [postKeys.lists()],
    onSuccess,
    onError,
  })
}

interface UseUpdatePostOptions {
  onSuccess?: (post: unknown) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update a post.
 */
export function useUpdatePost({ onSuccess, onError }: UseUpdatePostOptions = {}) {
  return useActionMutation<UpdatePostInput, unknown>({
    action: updatePostAction,
    invalidateKeys: [postKeys.lists(), postKeys.details()],
    onSuccess,
    onError,
  })
}

interface UseDeletePostOptions {
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a post (soft or permanent).
 */
export function useDeletePost({ onSuccess, onError }: UseDeletePostOptions = {}) {
  return useActionMutation<DeletePostInput, { success: boolean }>({
    action: deletePostAction,
    invalidateKeys: [postKeys.lists()],
    onSuccess: () => onSuccess?.(),
    onError,
  })
}

interface UseChangeStatusOptions {
  postId: PostId
  onSuccess?: (post: unknown) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to change post status.
 */
export function useChangePostStatus({ postId, onSuccess, onError }: UseChangeStatusOptions) {
  return useActionMutation<ChangeStatusInput, unknown>({
    action: changePostStatusAction,
    invalidateKeys: [postKeys.lists(), postKeys.detail(postId)],
    onSuccess,
    onError,
  })
}

interface UseUpdateTagsOptions {
  postId: PostId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update tags on a post.
 */
export function useUpdatePostTags({ postId, onSuccess, onError }: UseUpdateTagsOptions) {
  return useActionMutation<UpdateTagsInput, { success: boolean }>({
    action: updatePostTagsAction,
    invalidateKeys: [postKeys.lists(), postKeys.detail(postId)],
    onSuccess: () => onSuccess?.(),
    onError,
  })
}

interface UseRestorePostOptions {
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to restore a soft-deleted post.
 */
export function useRestorePost({ onSuccess, onError }: UseRestorePostOptions = {}) {
  return useActionMutation<RestorePostInput, { success: boolean }>({
    action: restorePostAction,
    invalidateKeys: [postKeys.lists()],
    onSuccess: () => onSuccess?.(),
    onError,
  })
}
