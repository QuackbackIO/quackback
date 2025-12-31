import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchInboxPostsForAdmin,
  createPostFn,
  fetchPostWithDetails,
  updatePostFn,
  deletePostFn,
  changePostStatusFn,
  updatePostTagsFn,
  restorePostFn,
  type ListInboxPostsInput,
  type CreatePostInput,
  type UpdatePostInput,
  type DeletePostInput,
  type ChangeStatusInput,
  type UpdateTagsInput,
  type RestorePostInput,
} from '@/lib/server-functions/posts'
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
      return await fetchInboxPostsForAdmin({
        data: {
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
        } as ListInboxPostsInput,
      })
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
      return await fetchPostWithDetails({
        data: {
          id: postId,
        },
      })
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new post.
 */
export function useCreatePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreatePostInput) => {
      return await createPostFn({ data: input })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: postKeys.lists() })
    },
  })
}

/**
 * Hook to update a post.
 */
export function useUpdatePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdatePostInput) => {
      return await updatePostFn({ data: input })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: postKeys.lists() })
      queryClient.invalidateQueries({ queryKey: postKeys.details() })
    },
  })
}

/**
 * Hook to delete a post (soft or permanent).
 */
export function useDeletePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: DeletePostInput) => {
      return await deletePostFn({ data: input })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: postKeys.lists() })
    },
  })
}

/**
 * Hook to change post status.
 */
export function useChangePostStatus(postId: PostId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ChangeStatusInput) => {
      return await changePostStatusFn({ data: input })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: postKeys.lists() })
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
    },
  })
}

/**
 * Hook to update tags on a post.
 */
export function useUpdatePostTags(postId: PostId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateTagsInput) => {
      return await updatePostTagsFn({ data: input })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: postKeys.lists() })
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
    },
  })
}

/**
 * Hook to restore a soft-deleted post.
 */
export function useRestorePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RestorePostInput) => {
      return await restorePostFn({ data: input })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: postKeys.lists() })
    },
  })
}
