'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { PublicFeedbackFilters } from '@/app/s/[orgSlug]/(portal)/use-public-filters'
import type { PublicPostListItem } from '@quackback/domain'

// ============================================================================
// Types
// ============================================================================

interface PublicPostListResult {
  items: PublicPostListItem[]
  total: number
  hasMore: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const publicPostsKeys = {
  all: ['publicPosts'] as const,
  lists: () => [...publicPostsKeys.all, 'list'] as const,
  list: (organizationId: string, filters: PublicFeedbackFilters) =>
    [...publicPostsKeys.lists(), organizationId, filters] as const,
}

// ============================================================================
// Fetch Function
// ============================================================================

async function fetchPublicPosts(
  organizationId: string,
  filters: PublicFeedbackFilters,
  page: number
): Promise<PublicPostListResult> {
  const params = new URLSearchParams({
    organizationId,
    page: page.toString(),
    limit: '20',
  })

  if (filters.board) params.set('board', filters.board)
  if (filters.search) params.set('search', filters.search)
  if (filters.sort) params.set('sort', filters.sort)
  filters.status?.forEach((s) => params.append('status', s))
  filters.tagIds?.forEach((t) => params.append('tagIds', t))

  const response = await fetch(`/api/public/posts?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch posts')
  return response.json()
}

// ============================================================================
// Query Hook
// ============================================================================

interface UsePublicPostsOptions {
  organizationId: string
  filters: PublicFeedbackFilters
  initialData?: PublicPostListResult
}

export function usePublicPosts({ organizationId, filters, initialData }: UsePublicPostsOptions) {
  return useInfiniteQuery({
    queryKey: publicPostsKeys.list(organizationId, filters),
    queryFn: ({ pageParam }) => fetchPublicPosts(organizationId, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    refetchOnMount: !initialData,
  })
}

// Helper to flatten paginated posts into a single array
export function flattenPublicPosts(
  data: InfiniteData<PublicPostListResult> | undefined
): PublicPostListItem[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}

// ============================================================================
// Vote Mutation
// ============================================================================

interface VoteResponse {
  voteCount: number
  voted: boolean
}

interface VoteMutationContext {
  previousLists: [readonly unknown[], InfiniteData<PublicPostListResult> | undefined][]
}

export function useVoteMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: string): Promise<VoteResponse> => {
      const response = await fetch(`/api/public/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to vote')
      return response.json()
    },
    onMutate: async (_postId): Promise<VoteMutationContext> => {
      // Cancel any outgoing refetches for all public post lists
      await queryClient.cancelQueries({ queryKey: publicPostsKeys.lists() })

      // Snapshot ALL list queries
      const previousLists = queryClient.getQueriesData<InfiniteData<PublicPostListResult>>({
        queryKey: publicPostsKeys.lists(),
      })

      // Note: We don't optimistically update the cache here because:
      // 1. hasVoted is user-specific and not part of PublicPostListItem
      // 2. The local state in usePostVote handles immediate UI feedback
      // 3. onSuccess will sync the voteCount from the server response

      return { previousLists }
    },
    onError: (_err, _postId, context) => {
      // Rollback all list queries on error
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSuccess: (data, postId) => {
      // Update voteCount with server response for accuracy
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
    },
  })
}

// ============================================================================
// Create Post Mutation (for public portal)
// ============================================================================

interface CreatePostInput {
  boardId: string
  title: string
  content: string
  contentJson: unknown
}

interface CreatePostResponse {
  id: string
  title: string
  content: string
  status: string
  voteCount: number
  createdAt: string
  board: { id: string; name: string; slug: string }
}

export function useCreatePublicPost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      boardId,
      title,
      content,
      contentJson,
    }: CreatePostInput): Promise<CreatePostResponse> => {
      const response = await fetch(`/api/public/boards/${boardId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, contentJson }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create post')
      }
      return response.json()
    },
    onSuccess: (newPost) => {
      // Add new post to the beginning of all list queries
      queryClient.setQueriesData<InfiniteData<PublicPostListResult>>(
        { queryKey: publicPostsKeys.lists() },
        (old) => {
          if (!old) return old

          // Create the new post item matching PublicPostListItem shape
          const newPostItem: PublicPostListItem = {
            id: newPost.id,
            title: newPost.title,
            content: newPost.content,
            status: newPost.status as PublicPostListItem['status'],
            voteCount: newPost.voteCount,
            authorName: null, // Will be filled by server on refetch
            memberId: null,
            createdAt: new Date(newPost.createdAt),
            commentCount: 0,
            tags: [],
            board: newPost.board,
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
// Voted Posts State Hook
// ============================================================================

interface VotedPostsResponse {
  votedPostIds: string[]
}

async function fetchVotedPosts(
  organizationId: string,
  postIds: string[]
): Promise<VotedPostsResponse> {
  if (postIds.length === 0) {
    return { votedPostIds: [] }
  }
  const response = await fetch(
    `/api/public/votes?organizationId=${organizationId}&postIds=${postIds.join(',')}`
  )
  if (!response.ok) {
    return { votedPostIds: [] }
  }
  return response.json()
}

interface UseVotedPostsOptions {
  initialVotedIds: string[]
  organizationId: string
  postIds: string[]
}

/**
 * Hook to track which posts the user has voted on.
 * Maintains client-side state that stays in sync with voting actions.
 * Supports refetching after auth to sync with server state.
 */
export function useVotedPosts({ initialVotedIds, organizationId, postIds }: UseVotedPostsOptions) {
  const [votedIds, setVotedIds] = useState(() => new Set(initialVotedIds))

  const hasVoted = useCallback((postId: string) => votedIds.has(postId), [votedIds])

  const toggleVote = useCallback((postId: string, voted: boolean) => {
    setVotedIds((prev) => {
      const next = new Set(prev)
      if (voted) {
        next.add(postId)
      } else {
        next.delete(postId)
      }
      return next
    })
  }, [])

  const refetchVotedPosts = useCallback(async () => {
    const result = await fetchVotedPosts(organizationId, postIds)
    setVotedIds(new Set(result.votedPostIds))
  }, [organizationId, postIds])

  return useMemo(
    () => ({ hasVoted, toggleVote, refetchVotedPosts }),
    [hasVoted, toggleVote, refetchVotedPosts]
  )
}
