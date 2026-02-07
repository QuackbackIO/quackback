/**
 * Post merge mutations for admin
 *
 * Mutation hooks for merging/unmerging duplicate feedback posts.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mergePostFn, unmergePostFn } from '@/lib/server/functions/post-merge'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import type { PostId } from '@quackback/ids'

// ============================================================================
// Merge Post Mutation
// ============================================================================

interface MergePostInput {
  duplicatePostId: PostId
  canonicalPostId: PostId
}

export function useMergePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ duplicatePostId, canonicalPostId }: MergePostInput) =>
      mergePostFn({ data: { duplicatePostId, canonicalPostId } }),
    onSuccess: (_data, { duplicatePostId, canonicalPostId }) => {
      // Invalidate both post details and the inbox list
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(duplicatePostId) })
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(canonicalPostId) })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    },
  })
}

// ============================================================================
// Unmerge Post Mutation
// ============================================================================

export function useUnmergePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId) => unmergePostFn({ data: { postId } }),
    onSuccess: (data) => {
      // Invalidate the unmerged post, canonical post, and inbox lists
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(data.post.id as PostId) })
      queryClient.invalidateQueries({
        queryKey: inboxKeys.detail(data.canonicalPost.id as PostId),
      })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    },
  })
}
