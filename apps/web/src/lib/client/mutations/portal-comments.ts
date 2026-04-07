/**
 * Portal comment mutations
 *
 * Mutation hooks for portal comment operations (create, edit, delete, reactions, pin).
 * Query hooks are in @/lib/client/hooks/use-comments-query.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCommentFn,
  userEditCommentFn,
  userDeleteCommentFn,
  restoreCommentFn,
  addReactionFn,
  removeReactionFn,
  pinCommentFn,
  unpinCommentFn,
} from '@/lib/server/functions/comments'
import type { PostId, CommentId } from '@quackback/ids'
import { portalDetailQueries } from '@/lib/client/queries/portal-detail'
import { commentKeys } from '@/lib/client/hooks/use-comments-query'
import { addReplyToTree, replaceOptimisticInTree } from '@/lib/client/utils/comment-tree-helpers'

// ============================================================================
// Types
// ============================================================================

interface OptimisticComment {
  id: CommentId
  content: string
  authorName: string | null
  principalId: string | null
  createdAt: string
  parentId: string | null
  isTeamMember: boolean
  isPrivate?: boolean
  replies: OptimisticComment[]
  reactions: Array<{ emoji: string; count: number; hasReacted: boolean }>
}

interface CreateCommentInput {
  content: string
  parentId?: string | null
  postId: string
  authorName?: string | null
  authorEmail?: string | null
  principalId?: string | null
  statusId?: string | null
  isPrivate?: boolean
}

interface UseCreateCommentOptions {
  postId: PostId
  author?: { name: string | null; email: string; principalId?: string }
  onSuccess?: (comment: unknown) => void
  onError?: (error: Error) => void
}

interface UseEditCommentOptions {
  commentId: CommentId
  postId: PostId
  onSuccess?: (comment: unknown) => void
  onError?: (error: Error) => void
}

interface UseDeleteCommentOptions {
  commentId?: CommentId
  postId: PostId
  onSuccess?: () => void
  onError?: (error: Error) => void
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

interface UsePinCommentOptions {
  postId: PostId
  onSuccess?: () => void
  onError?: (error: Error) => void
}

interface UseUnpinCommentOptions {
  postId: PostId
  onSuccess?: () => void
  onError?: (error: Error) => void
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a comment on a post with optimistic updates.
 */
export function useCreateComment({ postId, author, onSuccess, onError }: UseCreateCommentOptions) {
  const queryClient = useQueryClient()
  const queryKey = ['portal', 'post', postId]

  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      createCommentFn({
        data: {
          postId,
          content: input.content,
          parentId: (input.parentId || undefined) as CommentId | undefined,
          statusId: input.statusId || undefined,
          isPrivate: input.isPrivate,
        },
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey })
      const previousPost = queryClient.getQueryData(queryKey)

      const authorName = input.authorName ?? author?.name ?? author?.email ?? null
      const principalId = input.principalId ?? author?.principalId ?? null

      if (previousPost && (authorName || author)) {
        const optimisticComment: OptimisticComment = {
          id: `comment_optimistic_${Date.now()}` as CommentId,
          content: input.content,
          authorName,
          principalId,
          createdAt: new Date().toISOString(),
          parentId: input.parentId || null,
          isTeamMember: false,
          replies: [],
          reactions: [],
        }

        queryClient.setQueryData(queryKey, (old: unknown) => {
          if (!old || typeof old !== 'object') return old
          const post = old as { comments: OptimisticComment[] }
          const comments = input.parentId
            ? addReplyToTree(post.comments, input.parentId, optimisticComment)
            : [optimisticComment, ...post.comments]
          return { ...post, comments }
        })
      }

      return { previousPost }
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousPost) {
        queryClient.setQueryData(queryKey, context.previousPost)
      }
      onError?.(error)
    },
    onSuccess: (data, input) => {
      const serverComment = data as { comment: { id: CommentId; createdAt: Date } }
      queryClient.setQueryData(queryKey, (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        const post = old as { comments: OptimisticComment[] }
        return {
          ...post,
          comments: replaceOptimisticInTree(
            post.comments,
            'comment_optimistic_',
            input.parentId ?? null,
            input.content,
            serverComment.comment
          ),
        }
      })
      // Always invalidate to ensure fresh server data replaces optimistic state
      queryClient.invalidateQueries({ queryKey })
      // Also invalidate admin inbox detail so comments appear in admin context
      queryClient.invalidateQueries({ queryKey: ['inbox', 'detail', postId] })
      onSuccess?.(data)
    },
  })
}

/**
 * Hook for a user to edit their own comment.
 */
export function useEditComment({ commentId, postId, onSuccess, onError }: UseEditCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (content: string) => userEditCommentFn({ data: { commentId, content } }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      queryClient.invalidateQueries({ queryKey: ['inbox', 'detail', postId] })
      queryClient.invalidateQueries({ queryKey: commentKeys.permission(commentId) })
      onSuccess?.(data)
    },
    onError,
  })
}

/**
 * Hook for a user to soft-delete their own comment.
 */
export function useDeleteComment({
  commentId: fixedCommentId,
  postId,
  onSuccess,
  onError,
}: UseDeleteCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (dynamicCommentId?: CommentId) =>
      userDeleteCommentFn({ data: { commentId: dynamicCommentId ?? fixedCommentId! } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      queryClient.invalidateQueries({ queryKey: ['inbox', 'detail', postId] })
      queryClient.invalidateQueries({ queryKey: ['activity', 'post', postId] })
      onSuccess?.()
    },
    onError,
  })
}

/**
 * Hook for a team member to restore a soft-deleted comment.
 */
export function useRestoreComment({
  postId,
  onSuccess,
  onError,
}: {
  postId: PostId
  onSuccess?: () => void
  onError?: (error: Error) => void
}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (commentId: CommentId) => restoreCommentFn({ data: { commentId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      queryClient.invalidateQueries({ queryKey: ['inbox', 'detail', postId] })
      queryClient.invalidateQueries({ queryKey: ['activity', 'post', postId] })
      onSuccess?.()
    },
    onError,
  })
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
    mutationFn: ({ emoji, hasReacted }: { emoji: string; hasReacted: boolean }) => {
      const fn = hasReacted ? removeReactionFn : addReactionFn
      return fn({ data: { commentId, emoji } })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      queryClient.invalidateQueries({ queryKey: ['inbox', 'detail', postId] })
      onSuccess?.(data)
    },
    onError,
  })
}

/**
 * Hook to pin a comment.
 */
export function usePinComment({ postId, onSuccess, onError }: UsePinCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (commentId: CommentId) => pinCommentFn({ data: { commentId } }),
    onSuccess: () => {
      // Invalidate both portal and admin queries
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      queryClient.invalidateQueries({ queryKey: ['inbox', 'detail', postId] })
      onSuccess?.()
    },
    onError,
  })
}

/**
 * Hook to unpin the currently pinned comment.
 */
export function useUnpinComment({ postId, onSuccess, onError }: UseUnpinCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => unpinCommentFn({ data: { postId } }),
    onSuccess: () => {
      // Invalidate both portal and admin queries
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      queryClient.invalidateQueries({ queryKey: ['inbox', 'detail', postId] })
      onSuccess?.()
    },
    onError,
  })
}
