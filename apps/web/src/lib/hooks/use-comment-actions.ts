import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCommentFn,
  getCommentPermissionsFn,
  userEditCommentFn,
  userDeleteCommentFn,
  toggleReactionFn,
} from '@/lib/server-functions/comments'
import type { PostId, CommentId } from '@quackback/ids'
import { portalDetailQueries } from '@/lib/queries/portal-detail'

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
  /** Author info for optimistic update */
  author?: {
    name: string | null
    email: string
    memberId?: string
  }
  onSuccess?: (comment: unknown) => void
  onError?: (error: Error) => void
}

interface OptimisticComment {
  id: CommentId
  content: string
  authorName: string | null
  memberId: string | null
  createdAt: string
  parentId: string | null
  isTeamMember: boolean
  replies: OptimisticComment[]
  reactions: Array<{ emoji: string; count: number; hasReacted: boolean }>
}

interface CreateCommentInput {
  content: string
  parentId?: string | null
  postId: string
  authorName?: string | null
  authorEmail?: string | null
  memberId?: string | null
}

/**
 * Hook to create a comment on a post with optimistic updates.
 */
export function useCreateComment({ postId, author, onSuccess, onError }: UseCreateCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateCommentInput) => {
      return await createCommentFn({
        data: {
          postId,
          content: input.content,
          parentId: (input.parentId || undefined) as CommentId | undefined,
        },
      })
    },
    onMutate: async (input) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['portal', 'post', postId] })

      // Snapshot previous value
      const previousPost = queryClient.getQueryData(['portal', 'post', postId])

      // Get author info from input (preferred) or hook options
      const authorName = input.authorName ?? author?.name ?? author?.email ?? null
      const memberId = input.memberId ?? author?.memberId ?? null

      // Optimistically add the new comment
      if (previousPost && (authorName || author)) {
        const optimisticComment: OptimisticComment = {
          id: `comment_optimistic_${Date.now()}` as CommentId,
          content: input.content,
          authorName,
          memberId,
          createdAt: new Date().toISOString(),
          parentId: input.parentId || null,
          isTeamMember: false,
          replies: [],
          reactions: [],
        }

        queryClient.setQueryData(['portal', 'post', postId], (old: unknown) => {
          if (!old || typeof old !== 'object') return old
          const post = old as { comments: OptimisticComment[] }

          if (input.parentId) {
            // Adding a reply - find parent comment and add to its replies
            const addReplyToComment = (comments: OptimisticComment[]): OptimisticComment[] => {
              return comments.map((comment) => {
                if (comment.id === input.parentId) {
                  return {
                    ...comment,
                    replies: [...comment.replies, optimisticComment],
                  }
                }
                if (comment.replies.length > 0) {
                  return {
                    ...comment,
                    replies: addReplyToComment(comment.replies),
                  }
                }
                return comment
              })
            }
            return {
              ...post,
              comments: addReplyToComment(post.comments),
            }
          } else {
            // Adding a top-level comment
            return {
              ...post,
              comments: [optimisticComment, ...post.comments],
            }
          }
        })
      }

      return { previousPost }
    },
    onError: (error: Error, _variables, context) => {
      // Rollback on error
      if (context?.previousPost) {
        queryClient.setQueryData(['portal', 'post', postId], context.previousPost)
      }
      onError?.(error)
    },
    onSuccess: (data, input) => {
      // Replace optimistic comment with real server data (no refetch needed)
      const serverComment = data as { comment: { id: CommentId; content: string; createdAt: Date } }

      queryClient.setQueryData(['portal', 'post', postId], (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        const post = old as { comments: OptimisticComment[] }

        const replaceOptimisticComment = (comments: OptimisticComment[]): OptimisticComment[] => {
          return comments.map((comment) => {
            // Replace optimistic comment with real one
            if (comment.id.startsWith('comment_optimistic_')) {
              // Check if this is the one we just created (same content and parent)
              const sameParent = (comment.parentId || null) === (input.parentId || null)
              const sameContent = comment.content === input.content
              if (sameParent && sameContent) {
                return {
                  ...comment,
                  id: serverComment.comment.id,
                  createdAt:
                    typeof serverComment.comment.createdAt === 'string'
                      ? serverComment.comment.createdAt
                      : serverComment.comment.createdAt.toISOString(),
                }
              }
            }
            // Recurse into replies
            if (comment.replies.length > 0) {
              return {
                ...comment,
                replies: replaceOptimisticComment(comment.replies),
              }
            }
            return comment
          })
        }

        return {
          ...post,
          comments: replaceOptimisticComment(post.comments),
        }
      })

      onSuccess?.(data)
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
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
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
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
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
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      onSuccess?.(data)
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}
