/**
 * Portal post mutations
 *
 * Mutation hooks for public portal post operations (voting, creating, editing, deleting).
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import {
  toggleVoteFn,
  createPublicPostFn,
  userEditPostFn,
  userDeletePostFn,
} from '@/lib/server/functions/public-posts'
import {
  publicPostsKeys,
  votedPostsKeys,
  postPermissionsKeys,
} from '@/lib/client/hooks/use-portal-posts-query'
import { portalDetailQueries, type PublicPostDetailView } from '@/lib/client/queries/portal-detail'
import type { PublicPostListItem } from '@/lib/server/domains/posts'
import type { PostId, BoardId, StatusId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

interface PublicPostListResult {
  items: PublicPostListItem[]
  total: number
  hasMore: boolean
}

interface VoteResponse {
  voteCount: number
  voted: boolean
}

interface VoteMutationContext {
  previousLists: [readonly unknown[], InfiniteData<PublicPostListResult> | undefined][]
  previousVotedPosts: Set<string> | undefined
  previousDetail: PublicPostDetailView | undefined
  postId: PostId
}

interface CreatePostInput {
  boardId: BoardId
  title: string
  content: string
  contentJson: unknown
}

interface UserEditPostInput {
  postId: PostId
  title: string
  content: string
  contentJson?: { type: 'doc'; content?: unknown[] }
}

interface UseUserEditPostOptions {
  onSuccess?: (post: unknown) => void
  onError?: (error: Error) => void
}

interface UseUserDeletePostOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

// ============================================================================
// Vote Mutation
// ============================================================================

export function useVoteMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId): Promise<VoteResponse> => toggleVoteFn({ data: { postId } }),
    onMutate: async (postId): Promise<VoteMutationContext> => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: publicPostsKeys.lists() })
      await queryClient.cancelQueries({ queryKey: votedPostsKeys.byWorkspace() })

      // Snapshot previous state for rollback
      const previousLists = queryClient.getQueriesData<InfiniteData<PublicPostListResult>>({
        queryKey: publicPostsKeys.lists(),
      })
      const previousVotedPosts = queryClient.getQueryData<Set<string>>(votedPostsKeys.byWorkspace())
      const previousDetail = queryClient.getQueryData<PublicPostDetailView>(
        portalDetailQueries.postDetail(postId).queryKey
      )

      // Get current vote state to determine optimistic update
      const currentlyVoted = previousVotedPosts?.has(postId) ?? false
      const newVoted = !currentlyVoted

      // OPTIMISTIC: Update votedPosts cache (hasVoted state)
      queryClient.setQueryData<Set<string>>(votedPostsKeys.byWorkspace(), (old) => {
        const next = new Set(old || [])
        if (newVoted) {
          next.add(postId)
        } else {
          next.delete(postId)
        }
        return next
      })

      // OPTIMISTIC: Update voteCount in all list queries
      queryClient.setQueriesData<InfiniteData<PublicPostListResult>>(
        { queryKey: publicPostsKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === postId
                  ? { ...post, voteCount: post.voteCount + (newVoted ? 1 : -1) }
                  : post
              ),
            })),
          }
        }
      )

      // OPTIMISTIC: Update voteCount in detail query (if cached)
      if (previousDetail) {
        queryClient.setQueryData<PublicPostDetailView>(
          portalDetailQueries.postDetail(postId).queryKey,
          (old) => (old ? { ...old, voteCount: old.voteCount + (newVoted ? 1 : -1) } : old)
        )
      }

      return { previousLists, previousVotedPosts, previousDetail, postId }
    },
    onError: (_err, _postId, context) => {
      // Rollback all caches on error
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
      if (context?.previousVotedPosts !== undefined) {
        queryClient.setQueryData(votedPostsKeys.byWorkspace(), context.previousVotedPosts)
      }
      if (context?.previousDetail && context?.postId) {
        queryClient.setQueryData(
          portalDetailQueries.postDetail(context.postId).queryKey,
          context.previousDetail
        )
      }
    },
    onSuccess: (data, postId) => {
      // Sync with server truth (corrects any optimistic drift)
      queryClient.setQueriesData<InfiniteData<PublicPostListResult>>(
        { queryKey: publicPostsKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === postId ? { ...post, voteCount: data.voteCount } : post
              ),
            })),
          }
        }
      )

      queryClient.setQueryData<PublicPostDetailView>(
        portalDetailQueries.postDetail(postId).queryKey,
        (old) => (old ? { ...old, voteCount: data.voteCount } : old)
      )

      queryClient.setQueryData<Set<string>>(votedPostsKeys.byWorkspace(), (old) => {
        const next = new Set(old || [])
        if (data.voted) {
          next.add(postId)
        } else {
          next.delete(postId)
        }
        return next
      })
    },
  })
}

// ============================================================================
// Create Post Mutation
// ============================================================================

export function useCreatePublicPost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ boardId, title, content, contentJson }: CreatePostInput) =>
      createPublicPostFn({
        data: {
          boardId,
          title,
          content,
          contentJson: contentJson as { type: 'doc'; content?: unknown[] },
        },
      }),
    onSuccess: (newPost) => {
      // Add new post to the beginning of all list queries
      queryClient.setQueriesData<InfiniteData<PublicPostListResult>>(
        { queryKey: publicPostsKeys.lists() },
        (old) => {
          if (!old) return old

          // Create the new post item matching PublicPostListItem shape
          // Cast id as PostId since API returns TypeID format strings
          const newPostItem: PublicPostListItem = {
            id: newPost.id as PostId,
            title: newPost.title,
            content: newPost.content,
            statusId: newPost.statusId as StatusId | null,
            voteCount: newPost.voteCount,
            authorName: null, // Will be filled by server on refetch
            principalId: null,
            createdAt: new Date(newPost.createdAt),
            commentCount: 0,
            tags: [],
            board: { ...newPost.board, id: newPost.board.id as BoardId },
          }

          return {
            ...old,
            pages: old.pages.map((page, index) => {
              // Add to first page only
              if (index === 0) {
                return {
                  ...page,
                  items: [newPostItem, ...page.items],
                  total: page.total + 1,
                }
              }
              return page
            }),
          }
        }
      )

      // Invalidate to get fresh data with all fields populated
      queryClient.invalidateQueries({ queryKey: publicPostsKeys.lists() })
    },
  })
}

// ============================================================================
// User Edit Post Mutation
// ============================================================================

/**
 * Hook for a user to edit their own post.
 */
export function useUserEditPost({ onSuccess, onError }: UseUserEditPostOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UserEditPostInput) => userEditPostFn({ data: input }),
    onSuccess: (data, variables) => {
      // Update post in all list queries
      queryClient.setQueriesData<InfiniteData<PublicPostListResult>>(
        { queryKey: publicPostsKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === variables.postId
                  ? { ...post, title: variables.title, content: variables.content }
                  : post
              ),
            })),
          }
        }
      )
      // Update the detail query (if cached)
      queryClient.setQueryData<PublicPostDetailView>(
        portalDetailQueries.postDetail(variables.postId).queryKey,
        (old) => {
          if (!old) return old
          return {
            ...old,
            title: variables.title,
            content: variables.content,
            contentJson: variables.contentJson ?? old.contentJson,
          }
        }
      )
      // Invalidate permissions as they may have changed
      queryClient.invalidateQueries({ queryKey: postPermissionsKeys.detail(variables.postId) })
      onSuccess?.(data)
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}

// ============================================================================
// User Delete Post Mutation
// ============================================================================

/**
 * Hook for a user to soft-delete their own post.
 */
export function useUserDeletePost({ onSuccess, onError }: UseUserDeletePostOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId) => userDeletePostFn({ data: { postId } }),
    onSuccess: (_, postId) => {
      // Remove post from all list queries
      queryClient.setQueriesData<InfiniteData<PublicPostListResult>>(
        { queryKey: publicPostsKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((post) => post.id !== postId),
              total: page.total - 1,
            })),
          }
        }
      )
      // Remove the detail query from cache
      queryClient.removeQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      // Invalidate to get fresh data
      queryClient.invalidateQueries({ queryKey: publicPostsKeys.lists() })
      onSuccess?.()
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}
