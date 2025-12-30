'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCommentAction,
  getCommentPermissionsAction,
  userEditCommentAction,
  userDeleteCommentAction,
  toggleReactionAction,
} from '@/lib/actions/comments'
import type { ActionError } from '@/lib/actions/types'
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
      const result = await getCommentPermissionsAction({ data: { commentId } })
      if (!result.success) {
        return { canEdit: false, canDelete: false }
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

interface UseCreateCommentOptions {
  postId: PostId
  onSuccess?: (comment: unknown) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a comment on a post.
 */
export function useCreateComment({ postId, onSuccess, onError }: UseCreateCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { content: string; parentId?: string | null }) => {
      const result = await createCommentAction({
        data: {
          postId,
          content: input.content,
          parentId: input.parentId,
        },
      })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      // Invalidate post details to refresh comments
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}

interface UseEditCommentOptions {
  commentId: CommentId
  postId: PostId
  onSuccess?: (comment: unknown) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook for a user to edit their own comment.
 */
export function useEditComment({ commentId, postId, onSuccess, onError }: UseEditCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (content: string) => {
      const result = await userEditCommentAction({ data: { commentId, content } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      // Invalidate post details to refresh comments
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      // Invalidate permissions as they may have changed
      queryClient.invalidateQueries({ queryKey: commentKeys.permission(commentId) })
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}

interface UseDeleteCommentOptions {
  commentId: CommentId
  postId: PostId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
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
      const result = await userDeleteCommentAction({ data: { commentId } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: () => {
      // Invalidate post details to refresh comments
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      onSuccess?.()
    },
    onError: (error: ActionError) => {
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
  onError?: (error: ActionError) => void
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
      const result = await toggleReactionAction({ data: { commentId, emoji } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      // Invalidate post details to refresh reaction counts
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) })
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}
