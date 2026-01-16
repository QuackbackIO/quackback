import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createCommentFn,
  getCommentPermissionsFn,
  userEditCommentFn,
  userDeleteCommentFn,
  toggleReactionFn,
  pinCommentFn,
  unpinCommentFn,
  canPinCommentFn,
} from '@/lib/server-functions/comments'
import type { PostId, CommentId } from '@quackback/ids'
import { portalDetailQueries } from '@/lib/queries/portal-detail'

// ============================================================================
// Types
// ============================================================================

interface CommentPermissions {
  canEdit: boolean
  canDelete: boolean
  editReason?: string
  deleteReason?: string
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

interface UseCreateCommentOptions {
  postId: PostId
  author?: { name: string | null; email: string; memberId?: string }
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
  commentId: CommentId
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

// ============================================================================
// Query Key Factory
// ============================================================================

export const commentKeys = {
  all: ['comments'] as const,
  permissions: () => [...commentKeys.all, 'permissions'] as const,
  permission: (commentId: CommentId) => [...commentKeys.permissions(), commentId] as const,
}

// ============================================================================
// Query Hook
// ============================================================================

/**
 * Hook to get edit/delete permissions for a comment.
 */
export function useCommentPermissions({
  commentId,
  enabled = true,
}: {
  commentId: CommentId
  enabled?: boolean
}) {
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
    staleTime: 30 * 1000,
  })
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
        },
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey })
      const previousPost = queryClient.getQueryData(queryKey)

      const authorName = input.authorName ?? author?.name ?? author?.email ?? null
      const memberId = input.memberId ?? author?.memberId ?? null

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

        queryClient.setQueryData(queryKey, (old: unknown) => {
          if (!old || typeof old !== 'object') return old
          const post = old as { comments: OptimisticComment[] }
          const comments = input.parentId
            ? addReplyToComments(post.comments, input.parentId, optimisticComment)
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
          comments: replaceOptimisticInComments(
            post.comments,
            input.parentId ?? null,
            input.content,
            serverComment.comment
          ),
        }
      })
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
  commentId,
  postId,
  onSuccess,
  onError,
}: UseDeleteCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => userDeleteCommentFn({ data: { commentId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
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
    mutationFn: (emoji: string) => toggleReactionFn({ data: { commentId, emoji } }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      onSuccess?.(data)
    },
    onError,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Add a reply to the correct parent in a nested comment structure */
function addReplyToComments(
  comments: OptimisticComment[],
  parentId: string,
  reply: OptimisticComment
): OptimisticComment[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return { ...comment, replies: [...comment.replies, reply] }
    }
    if (comment.replies.length > 0) {
      return { ...comment, replies: addReplyToComments(comment.replies, parentId, reply) }
    }
    return comment
  })
}

/** Replace optimistic comment with real server data */
function replaceOptimisticInComments(
  comments: OptimisticComment[],
  parentId: string | null,
  content: string,
  serverComment: { id: CommentId; createdAt: Date }
): OptimisticComment[] {
  return comments.map((comment) => {
    if (comment.id.startsWith('comment_optimistic_')) {
      const sameParent = (comment.parentId || null) === (parentId || null)
      const sameContent = comment.content === content
      if (sameParent && sameContent) {
        const createdAt =
          typeof serverComment.createdAt === 'string'
            ? serverComment.createdAt
            : serverComment.createdAt.toISOString()
        return { ...comment, id: serverComment.id, createdAt }
      }
    }
    if (comment.replies.length > 0) {
      return {
        ...comment,
        replies: replaceOptimisticInComments(comment.replies, parentId, content, serverComment),
      }
    }
    return comment
  })
}

// ============================================================================
// Pin/Unpin Hooks (Official Response)
// ============================================================================

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

/**
 * Hook to check if a comment can be pinned as the official response.
 */
export function useCanPinComment({
  commentId,
  enabled = true,
}: {
  commentId: CommentId
  enabled?: boolean
}) {
  return useQuery({
    queryKey: [...commentKeys.all, 'canPin', commentId],
    queryFn: async () => {
      try {
        return await canPinCommentFn({ data: { commentId } })
      } catch {
        return { canPin: false, reason: 'An error occurred' }
      }
    },
    enabled,
    staleTime: 30 * 1000,
  })
}

/**
 * Hook to pin a comment as the official response.
 */
export function usePinComment({ postId, onSuccess, onError }: UsePinCommentOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (commentId: CommentId) => pinCommentFn({ data: { commentId } }),
    onSuccess: () => {
      // Invalidate both portal and admin queries
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      queryClient.invalidateQueries({ queryKey: ['admin', 'post', postId] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'post', postId] })
      onSuccess?.()
    },
    onError,
  })
}
