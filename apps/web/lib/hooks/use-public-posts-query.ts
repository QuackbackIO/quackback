'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { PublicFeedbackFilters } from '@/app/s/[orgSlug]/(portal)/use-public-filters'
import type { PublicPostListItem } from '@quackback/domain'
import type { PostId, BoardId, StatusId } from '@quackback/ids'

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

export const votedPostsKeys = {
  all: ['votedPosts'] as const,
  byOrg: (organizationId: string) => [...votedPostsKeys.all, organizationId] as const,
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
  statusId: StatusId | null
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

      // Get response text first to debug empty responses
      const text = await response.text()

      if (!response.ok) {
        // Try to parse error message from response
        try {
          const data = JSON.parse(text)
          throw new Error(data.error || 'Failed to create post')
        } catch {
          throw new Error(`Failed to create post (status ${response.status})`)
        }
      }

      // Parse successful response
      if (!text) {
        throw new Error('Server returned empty response')
      }

      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`)
      }
    },
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
            memberId: null,
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
// Voted Posts Query Hook
// ============================================================================

interface VotedPostsResponse {
  votedPostIds: string[]
}

async function fetchVotedPosts(organizationId: string): Promise<Set<string>> {
  const response = await fetch(`/api/public/votes?organizationId=${organizationId}`)
  if (!response.ok) {
    return new Set()
  }
  const data: VotedPostsResponse = await response.json()
  return new Set(data.votedPostIds)
}

interface UseVotedPostsOptions {
  initialVotedIds: string[]
  organizationId: string
}

/**
 * Hook to track which posts the user has voted on.
 * Uses React Query for server state with local optimistic updates.
 * Call refetch() after auth to sync with server state.
 */
export function useVotedPosts({ initialVotedIds, organizationId }: UseVotedPostsOptions) {
  const queryClient = useQueryClient()

  // Local state for optimistic updates (immediate UI feedback)
  const [localVotedIds, setLocalVotedIds] = useState(() => new Set(initialVotedIds))

  // React Query for server state
  const { data: serverVotedIds, refetch } = useQuery({
    queryKey: votedPostsKeys.byOrg(organizationId),
    queryFn: () => fetchVotedPosts(organizationId),
    initialData: new Set(initialVotedIds),
    staleTime: Infinity, // Don't auto-refetch, we control when to refetch
  })

  // Sync local state when server data changes (e.g., after refetch)
  useEffect(() => {
    if (serverVotedIds) {
      setLocalVotedIds(serverVotedIds)
    }
  }, [serverVotedIds])

  const hasVoted = useCallback((postId: string) => localVotedIds.has(postId), [localVotedIds])

  // Optimistically update local state, server state syncs via vote mutation
  const toggleVote = useCallback(
    (postId: string, voted: boolean) => {
      setLocalVotedIds((prev) => {
        const next = new Set(prev)
        if (voted) {
          next.add(postId)
        } else {
          next.delete(postId)
        }
        return next
      })
      // Also update the query cache for consistency
      queryClient.setQueryData<Set<string>>(votedPostsKeys.byOrg(organizationId), (old) => {
        if (!old) return new Set([postId])
        const next = new Set(old)
        if (voted) {
          next.add(postId)
        } else {
          next.delete(postId)
        }
        return next
      })
    },
    [organizationId, queryClient]
  )

  const refetchVotedPosts = useCallback(() => {
    refetch()
  }, [refetch])

  return useMemo(
    () => ({ hasVoted, toggleVote, refetchVotedPosts }),
    [hasVoted, toggleVote, refetchVotedPosts]
  )
}
