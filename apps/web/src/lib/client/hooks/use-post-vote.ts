import { useQuery, useQueryClient } from '@tanstack/react-query'
import { votedPostsKeys, fetchVotedPosts } from './use-portal-posts-query'
import { useVoteMutation } from '@/lib/client/mutations/portal-posts'
import type { PostId } from '@quackback/ids'

// ============================================================================
// Query Keys
// ============================================================================

export const voteCountKeys = {
  all: ['voteCount'] as const,
  byPost: (postId: PostId) => [...voteCountKeys.all, postId] as const,
}

// ============================================================================
// Types
// ============================================================================

interface UsePostVoteOptions {
  postId: PostId
  voteCount: number // Initial vote count (seeds cache)
  /** Set to false to disable queries (e.g. readonly mode) */
  enabled?: boolean
  /**
   * Called at request time to supply auth headers. Used by surfaces where
   * cookie-based session is unavailable (e.g. the widget iframe, which
   * authenticates with a Bearer token). Portal/admin callers omit this;
   * cookie auth continues to work unchanged.
   *
   * Note: the voted-state query (`fetchVotedPosts`) is a globally-keyed
   * cache shared across all call sites and cannot accept per-call headers
   * without a broader refactor. Widget visitors will see `hasVoted: false`
   * on load (the toggle mutation still carries their token, so the vote
   * lands correctly and the optimistic update reflects immediately).
   */
  getAuthHeaders?: () => Record<string, string>
  /** Called after a refused vote is rolled back, so the caller can say why. */
  onError?: (error: Error) => void
}

interface UsePostVoteReturn {
  voteCount: number
  hasVoted: boolean
  isPending: boolean
  handleVote: (e?: React.MouseEvent) => void
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing post voting with TanStack Query as single source of truth.
 * Optimistic updates handled via query cache manipulation.
 *
 * @param postId - The post ID to vote on
 * @param voteCount - Initial vote count (seeds the cache)
 */
export function usePostVote({
  postId,
  voteCount,
  enabled = true,
  getAuthHeaders,
  onError,
}: UsePostVoteOptions): UsePostVoteReturn {
  const queryClient = useQueryClient()

  // Subscribe to per-post vote count cache
  // Seeded with initial value, updated optimistically by mutation
  const { data: cachedVoteCount } = useQuery({
    queryKey: voteCountKeys.byPost(postId),
    queryFn: () => voteCount,
    // Only seed cache when enabled — in readonly mode (e.g. merge preview),
    // initialData would overwrite the real post's cached count with a simulated value
    ...(enabled && { initialData: voteCount }),
    staleTime: Infinity, // Never refetch, rely on cache updates
    enabled,
  })

  // Subscribe to votedPosts cache for hasVoted state
  // Has queryFn so it works even if useVotedPosts wasn't called (e.g., direct post detail navigation)
  const { data: votedPosts } = useQuery<Set<string>>({
    queryKey: votedPostsKeys.byWorkspace(),
    queryFn: fetchVotedPosts,
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled,
  })

  const hasVoted = votedPosts?.has(postId) ?? false
  const voteMutation = useVoteMutation(getAuthHeaders ? { getAuthHeaders } : undefined)

  function handleVote(e?: React.MouseEvent): void {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    const newVoted = !hasVoted

    // Optimistic update for vote count
    queryClient.setQueryData<number>(
      voteCountKeys.byPost(postId),
      (old) => (old ?? voteCount) + (newVoted ? 1 : -1)
    )

    voteMutation.mutate(postId, {
      onError: (error) => {
        // Revert on error
        queryClient.setQueryData<number>(
          voteCountKeys.byPost(postId),
          (old) => (old ?? voteCount) + (newVoted ? -1 : 1)
        )
        onError?.(error)
      },
      onSuccess: (data) => {
        // Sync with server truth
        queryClient.setQueryData<number>(voteCountKeys.byPost(postId), data.voteCount)
      },
    })
  }

  return {
    voteCount: cachedVoteCount ?? voteCount,
    hasVoted,
    isPending: voteMutation.isPending,
    handleVote,
  }
}
