import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCommentFn,
  getCommentPermissionsFn,
  userEditCommentFn,
  userDeleteCommentFn,
  toggleReactionFn,
} from '@/lib/server-functions/comments'
import type { PostId, CommentId } from '@quackback/ids'
import { postKeys } from './use-post-actions'

// ============================================================================
// Query Key Factory
// ============================================================================

export const commentKeys = {
  all: ['comments'] as const,
  permissions: () => [...commentKeys.all, 'permissions'] as const,
  permission: (commentId: CommentId) => [...commentKeys.permissions(), commentId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseCommentPermissionsOptions {
  commentId: CommentId
  enabled?: boolean
}

interface CommentPermissions {
  canEdit: boolean
  canDelete: boolean
  editReason?: string
  deleteReason?: string
}

/**
 * Hook to get edit/delete permissions for a comment.
 */
export function useCommentPermissions({ commentId, enabled = true }: UseCommentPermissionsOptions) {
  return useQuery({
    queryKey: commentKeys.permission(commentId),
    queryFn: async (): Promise<CommentPermissions> => {
      try {
        return await getCommentPermissionsFn({ data: { commentId } })
      } catch {
        return { canEdit: false, canDelete: false }
      }
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface UseCreateCommentOptions {
  postId: PostId
  onSuccess?: (comment: unknown) => void
  onError?: (error: Error) => void
}

/**
 * Hook to create a comment on a post.
 */
export function useCreateComment({ postId, onSuccess, onError }: UseCreateCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { content: string; parentId?: string | null }) => {
      return await createCommentFn({
        data: {
          postId,
          content: input.content,
          parentId: (input.parentId || undefined) as CommentId | undefined,
        },
      })
    },
    onSuccess: (data) => {
      // Invalidate post details to refresh comments
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      onSuccess?.(data)
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}

interface UseEditCommentOptions {
  commentId: CommentId
  postId: PostId
  onSuccess?: (comment: unknown) => void
  onError?: (error: Error) => void
}

/**
 * Hook for a user to edit their own comment.
 */
export function useEditComment({ commentId, postId, onSuccess, onError }: UseEditCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (content: string) => {
      return await userEditCommentFn({ data: { commentId, content } })
    },
    onSuccess: (data) => {
      // Invalidate post details to refresh comments
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      // Invalidate permissions as they may have changed
      queryClient.invalidateQueries({ queryKey: commentKeys.permission(commentId) })
      onSuccess?.(data)
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}

interface UseDeleteCommentOptions {
  commentId: CommentId
  postId: PostId
  onSuccess?: () => void
  onError?: (error: Error) => void
}

/**
 * Hook for a user to soft-delete their own comment.
 */
export function useDeleteComment({
  commentId,
  postId,
  onSuccess,
  onError,
}: UseDeleteCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return await userDeleteCommentFn({ data: { commentId } })
    },
    onSuccess: () => {
      // Invalidate post details to refresh comments
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      onSuccess?.()
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}

interface UseToggleReactionOptions {
  commentId: CommentId
  postId: PostId
  onSuccess?: (result: {
    added: boolean
    reactions: Array<{ emoji: string; count: number; hasReacted: boolean }>
  }) => void
  onError?: (error: Error) => void
}

/**
 * Hook to toggle a reaction on a comment.
 */
export function useToggleReaction({
  commentId,
  postId,
  onSuccess,
  onError,
}: UseToggleReactionOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (emoji: string) => {
      return await toggleReactionFn({ data: { commentId, emoji } })
    },
    onSuccess: (data) => {
      // Invalidate post details to refresh reaction counts
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      onSuccess?.(data)
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}
