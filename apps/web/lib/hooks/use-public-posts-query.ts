'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  listPublicPostsAction,
  toggleVoteAction,
  createPublicPostAction,
  getVotedPostsAction,
  getPostPermissionsAction,
  userEditPostAction,
  userDeletePostAction,
} from '@/lib/actions/public-posts'
import type { ActionError } from '@/lib/actions/types'
import type { PublicFeedbackFilters } from '@/app/(portal)/use-public-filters'
import type { PublicPostListItem } from '@quackback/domain'
import type { PostId, BoardId, StatusId, TagId, WorkspaceId } from '@quackback/ids'

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
// Fetch Function (using server action)
// ============================================================================

async function fetchPublicPosts(
  organizationId: string,
  filters: PublicFeedbackFilters,
  page: number
): Promise<PublicPostListResult> {
  // Parse status filters - can be TypeIDs or slugs
  const statusIds: string[] = []
  const statusSlugs: string[] = []
  for (const s of filters.status || []) {
    if (s.startsWith('status_')) {
      statusIds.push(s)
    } else {
      statusSlugs.push(s)
    }
  }

  const result = await listPublicPostsAction({
    boardSlug: filters.board,
    search: filters.search,
    statusIds: statusIds.length > 0 ? (statusIds as StatusId[]) : undefined,
    statusSlugs: statusSlugs.length > 0 ? statusSlugs : undefined,
    tagIds: filters.tagIds as TagId[] | undefined,
    sort: filters.sort || 'top',
    page,
    limit: 20,
  })

  if (!result.success) {
    throw new Error(result.error.message)
  }

  return result.data as PublicPostListResult
}

// ============================================================================
// Query Hook
// ============================================================================

interface UsePublicPostsOptions {
  organizationId: string | null
  filters: PublicFeedbackFilters
  initialData?: PublicPostListResult
  enabled?: boolean
}

export function usePublicPosts({
  organizationId,
  filters,
  initialData,
  enabled = true,
}: UsePublicPostsOptions) {
  return useInfiniteQuery({
    queryKey: organizationId
      ? publicPostsKeys.list(organizationId, filters)
      : ['publicPosts', 'disabled'],
    queryFn: ({ pageParam }) => {
      if (!organizationId) {
        throw new Error('organizationId is required')
      }
      return fetchPublicPosts(organizationId, filters, pageParam)
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    // Keep showing previous data while loading new filter results
    placeholderData: (previousData) => previousData,
    enabled: enabled && !!organizationId,
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
// Vote Mutation (using server action)
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
    mutationFn: async (postId: PostId): Promise<VoteResponse> => {
      const result = await toggleVoteAction({ postId })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
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
// Create Post Mutation (using server action)
// ============================================================================

interface CreatePostInput {
  boardId: BoardId
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
  board: { id: BoardId; name: string; slug: string }
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
      const result = await createPublicPostAction({
        boardId,
        title,
        content,
        contentJson: contentJson as { type: 'doc'; content?: unknown[] },
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      return result.data as CreatePostResponse
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
// Voted Posts Query Hook (using server action)
// ============================================================================

async function fetchVotedPosts(organizationId: string): Promise<Set<string>> {
  const result = await getVotedPostsAction({})
  if (!result.success) {
    return new Set()
  }
  return new Set(result.data.votedPostIds)
}

interface UseVotedPostsOptions {
  initialVotedIds: string[]
  organizationId: string | null
  enabled?: boolean
}

/**
 * Hook to track which posts the user has voted on.
 * Uses React Query for server state with local optimistic updates.
 * Call refetch() after auth to sync with server state.
 */
export function useVotedPosts({
  initialVotedIds,
  organizationId,
  enabled = true,
}: UseVotedPostsOptions) {
  const queryClient = useQueryClient()

  // Local state for optimistic updates (immediate UI feedback)
  const [localVotedIds, setLocalVotedIds] = useState(() => new Set(initialVotedIds))

  // React Query for server state
  const { data: serverVotedIds, refetch } = useQuery({
    queryKey: organizationId ? votedPostsKeys.byOrg(organizationId) : ['votedPosts', 'disabled'],
    queryFn: () => {
      if (!organizationId) {
        return new Set<string>()
      }
      return fetchVotedPosts(organizationId)
    },
    initialData: new Set(initialVotedIds),
    staleTime: Infinity, // Don't auto-refetch, we control when to refetch
    enabled: enabled && !!organizationId,
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
      if (organizationId) {
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
      }
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

// ============================================================================
// Post Permissions Query
// ============================================================================

export const postPermissionsKeys = {
  all: ['postPermissions'] as const,
  detail: (postId: PostId) => [...postPermissionsKeys.all, postId] as const,
}

interface PostPermissions {
  canEdit: boolean
  canDelete: boolean
  editReason?: string
  deleteReason?: string
}

interface UsePostPermissionsOptions {
  postId: PostId
  enabled?: boolean
}

/**
 * Hook to get edit/delete permissions for a post.
 */
export function usePostPermissions({ postId, enabled = true }: UsePostPermissionsOptions) {
  return useQuery({
    queryKey: postPermissionsKeys.detail(postId),
    queryFn: async (): Promise<PostPermissions> => {
      const result = await getPostPermissionsAction({ postId })
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
// User Edit Post Mutation
// ============================================================================

interface UserEditPostInput {
  postId: PostId
  title: string
  content: string
  contentJson?: { type: 'doc'; content?: unknown[] }
}

interface UseUserEditPostOptions {
  onSuccess?: (post: unknown) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook for a user to edit their own post.
 */
export function useUserEditPost({ onSuccess, onError }: UseUserEditPostOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UserEditPostInput) => {
      const result = await userEditPostAction(input)
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
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
      // Invalidate permissions as they may have changed
      queryClient.invalidateQueries({ queryKey: postPermissionsKeys.detail(variables.postId) })
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}

// ============================================================================
// User Delete Post Mutation
// ============================================================================

interface UseUserDeletePostOptions {
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook for a user to soft-delete their own post.
 */
export function useUserDeletePost({ onSuccess, onError }: UseUserDeletePostOptions = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId) => {
      const result = await userDeletePostAction({ postId })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
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
      // Invalidate to get fresh data
      queryClient.invalidateQueries({ queryKey: publicPostsKeys.lists() })
      onSuccess?.()
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}
