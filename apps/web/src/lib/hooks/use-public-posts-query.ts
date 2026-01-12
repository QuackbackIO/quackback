import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  listPublicPostsFn,
  toggleVoteFn,
  createPublicPostFn,
  getVotedPostsFn,
  getPostPermissionsFn,
  userEditPostFn,
  userDeletePostFn,
} from '@/lib/server-functions/public-posts'
import { portalDetailQueries, type PublicPostDetailView } from '@/lib/queries/portal-detail'
import type { PublicFeedbackFilters } from '@/components/public/feedback/use-public-filters'
import type { PublicPostListItem } from '@/lib/posts'
import type { PostId, BoardId, StatusId, TagId } from '@quackback/ids'

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
  list: (filters: PublicFeedbackFilters) => [...publicPostsKeys.lists(), filters] as const,
}

export const votedPostsKeys = {
  all: ['votedPosts'] as const,
  byWorkspace: () => [...votedPostsKeys.all] as const,
}

export const postPermissionsKeys = {
  all: ['postPermissions'] as const,
  detail: (postId: PostId) => [...postPermissionsKeys.all, postId] as const,
}

// ============================================================================
// Fetch Function (using server action)
// ============================================================================

async function fetchPublicPosts(
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

  return (await listPublicPostsFn({
    data: {
      boardSlug: filters.board,
      search: filters.search,
      statusIds: statusIds.length > 0 ? (statusIds as StatusId[]) : undefined,
      statusSlugs: statusSlugs.length > 0 ? statusSlugs : undefined,
      tagIds: filters.tagIds as TagId[] | undefined,
      sort: filters.sort || 'top',
      page,
      limit: 20,
    },
  })) as unknown as PublicPostListResult
}

// ============================================================================
// Query Hook
// ============================================================================

interface UsePublicPostsOptions {
  filters: PublicFeedbackFilters
  initialData?: PublicPostListResult
  enabled?: boolean
}

export function usePublicPosts({ filters, initialData, enabled = true }: UsePublicPostsOptions) {
  return useInfiniteQuery({
    queryKey: publicPostsKeys.list(filters),
    queryFn: ({ pageParam }) => fetchPublicPosts(filters, pageParam),
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
    enabled,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated posts into a single array */
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
  previousVotedPosts: Set<string> | undefined
  previousDetail: PublicPostDetailView | undefined
  postId: PostId
}

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
// Create Post Mutation (using server action)
// ============================================================================

interface CreatePostInput {
  boardId: BoardId
  title: string
  content: string
  contentJson: unknown
}

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

export async function fetchVotedPosts(): Promise<Set<string>> {
  const result = await getVotedPostsFn()
  return new Set(result.votedPostIds)
}

interface UseVotedPostsOptions {
  initialVotedIds: string[]
  enabled?: boolean
}

/**
 * Hook to track which posts the user has voted on.
 * Uses TanStack Query as single source of truth - no local state.
 * Optimistic updates handled by useVoteMutation's onMutate.
 */
export function useVotedPosts({ initialVotedIds, enabled = true }: UseVotedPostsOptions) {
  const { data: votedIds, refetch } = useQuery({
    queryKey: votedPostsKeys.byWorkspace(),
    queryFn: fetchVotedPosts,
    initialData: new Set(initialVotedIds),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled,
  })

  return {
    hasVoted: (postId: string) => votedIds?.has(postId) ?? false,
    refetchVotedPosts: refetch,
  }
}

// ============================================================================
// Post Permissions Query
// ============================================================================

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
    queryFn: (): Promise<PostPermissions> => getPostPermissionsFn({ data: { postId } }),
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
  onError?: (error: Error) => void
}

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

interface UseUserDeletePostOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

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
