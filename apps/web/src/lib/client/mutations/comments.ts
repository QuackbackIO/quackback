/**
 * Comment mutations for admin inbox
 *
 * Mutation hooks for comment creation and reactions.
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { createCommentFn, addReactionFn, removeReactionFn } from '@/lib/server/functions/comments'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import type { PostDetails, CommentReaction, CommentWithReplies } from '@/lib/shared/types'
import type { InboxPostListResult } from '@/lib/shared/db-types'
import type { CommentId, PrincipalId, PostId } from '@quackback/ids'
import { addReplyToTree, replaceOptimisticInTree } from '@/lib/client/utils/comment-tree-helpers'

// ============================================================================
// Types
// ============================================================================

interface ToggleReactionInput {
  postId: PostId
  commentId: CommentId
  emoji: string
  /** Whether the current user has already reacted with this emoji */
  hasReacted: boolean
}

interface ToggleReactionResponse {
  reactions: CommentReaction[]
}

interface AddCommentInput {
  postId: string
  content: string
  parentId?: string | null
  authorName?: string | null
  authorEmail?: string | null
  principalId?: string | null
  isPrivate?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Update a post in all list caches */
function updatePostInLists(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: PostId,
  updater: (post: { commentCount: number }) => { commentCount: number }
): void {
  queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
    { queryKey: inboxKeys.lists() },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((post) =>
            post.id === postId ? { ...post, ...updater(post) } : post
          ),
        })),
      }
    }
  )
}

/** Optimistically update reactions in nested comment structure */
function updateCommentsReaction(
  comments: CommentWithReplies[],
  commentId: CommentId,
  emoji: string
): CommentWithReplies[] {
  return comments.map((comment) => {
    if (comment.id === commentId) {
      const existingReaction = comment.reactions?.find((r) => r.emoji === emoji)
      let newReactions: CommentReaction[]

      if (existingReaction?.hasReacted) {
        newReactions = comment.reactions
          .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, hasReacted: false } : r))
          .filter((r) => r.count > 0)
      } else if (existingReaction) {
        newReactions = comment.reactions.map((r) =>
          r.emoji === emoji ? { ...r, count: r.count + 1, hasReacted: true } : r
        )
      } else {
        newReactions = [...(comment.reactions || []), { emoji, count: 1, hasReacted: true }]
      }

      return { ...comment, reactions: newReactions }
    }

    if (comment.replies?.length) {
      return {
        ...comment,
        replies: updateCommentsReaction(comment.replies, commentId, emoji),
      }
    }

    return comment
  })
}

/** Update reactions from server response */
function updateCommentReactionsFromServer(
  comments: CommentWithReplies[],
  commentId: CommentId,
  reactions: CommentReaction[]
): CommentWithReplies[] {
  return comments.map((comment) => {
    if (comment.id === commentId) {
      return { ...comment, reactions }
    }

    if (comment.replies?.length) {
      return {
        ...comment,
        replies: updateCommentReactionsFromServer(comment.replies, commentId, reactions),
      }
    }

    return comment
  })
}

// ============================================================================
// Comment Reaction Mutation
// ============================================================================

export function useToggleCommentReaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      commentId,
      emoji,
      hasReacted,
    }: ToggleReactionInput): Promise<ToggleReactionResponse> => {
      const fn = hasReacted ? removeReactionFn : addReactionFn
      const result = await fn({ data: { commentId, emoji } })
      return { reactions: result.reactions }
    },
    onMutate: async ({ postId, commentId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId) })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(postId))

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), {
          ...previousDetail,
          comments: updateCommentsReaction(previousDetail.comments, commentId, emoji),
        })
      }

      return { previousDetail }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId), context.previousDetail)
      }
    },
    onSuccess: (data, { postId, commentId }) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), (old) => {
        if (!old) return old
        return {
          ...old,
          comments: updateCommentReactionsFromServer(old.comments, commentId, data.reactions),
        }
      })
    },
  })
}

// ============================================================================
// Add Comment Mutation
// ============================================================================

export function useAddComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, content, parentId, isPrivate }: AddCommentInput) =>
      createCommentFn({
        data: {
          postId: postId as PostId,
          content: content.trim(),
          parentId: (parentId || undefined) as CommentId | undefined,
          isPrivate,
        },
      }),
    onMutate: async ({ postId, content, parentId, authorName, principalId, isPrivate }) => {
      const typedPostId = postId as PostId
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(typedPostId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(typedPostId))
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      const optimisticComment: CommentWithReplies = {
        id: `comment_temp${Date.now()}` as CommentId,
        postId: typedPostId,
        content,
        authorName: authorName || null,
        principalId: principalId as PrincipalId,
        parentId: (parentId || null) as CommentId | null,
        isTeamMember: !!principalId,
        isPrivate: isPrivate ?? false,
        createdAt: new Date(),
        deletedAt: null,
        deletedByPrincipalId: null,
        replies: [],
        reactions: [],
      }

      if (previousDetail) {
        const updatedComments = parentId
          ? addReplyToTree(previousDetail.comments, parentId as CommentId, optimisticComment)
          : [...previousDetail.comments, optimisticComment]
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(typedPostId), {
          ...previousDetail,
          comments: updatedComments,
        })
      }
      // Private comments don't count toward the public comment count
      if (!isPrivate) {
        updatePostInLists(queryClient, typedPostId, (post) => ({
          commentCount: post.commentCount + 1,
        }))
      }

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      const typedPostId = postId as PostId
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(typedPostId), context.previousDetail)
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSuccess: (data, { postId, content, parentId }) => {
      const typedPostId = postId as PostId
      const serverComment = data as { comment: { id: CommentId; createdAt: Date } }

      queryClient.setQueryData<PostDetails>(inboxKeys.detail(typedPostId), (old) => {
        if (!old) return old
        return {
          ...old,
          comments: replaceOptimisticInTree(
            old.comments,
            'comment_temp',
            parentId ?? null,
            content,
            serverComment.comment
          ),
        }
      })
      // Invalidate to ensure fresh server data (avatar, team badge, etc.)
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(typedPostId) })
      // Also invalidate portal query so comments appear there too
      queryClient.invalidateQueries({ queryKey: ['portal', 'post', typedPostId] })
    },
  })
}
