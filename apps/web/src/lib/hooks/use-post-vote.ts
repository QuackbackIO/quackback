import { useQuery, useQueryClient } from '@tanstack/react-query'
import { votedPostsKeys, fetchVotedPosts } from './use-portal-posts-query'
import { useVoteMutation } from '@/lib/mutations/portal-posts'
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
export function usePostVote({ postId, voteCount }: UsePostVoteOptions): UsePostVoteReturn {
  const queryClient = useQueryClient()

  // Subscribe to per-post vote count cache
  // Seeded with initial value, updated optimistically by mutation
  const { data: cachedVoteCount } = useQuery({
    queryKey: voteCountKeys.byPost(postId),
    queryFn: () => voteCount,
    initialData: voteCount,
    staleTime: Infinity, // Never refetch, rely on cache updates
  })

  // Subscribe to votedPosts cache for hasVoted state
  // Has queryFn so it works even if useVotedPosts wasn't called (e.g., direct post detail navigation)
  const { data: votedPosts } = useQuery<Set<string>>({
    queryKey: votedPostsKeys.byWorkspace(),
    queryFn: fetchVotedPosts,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const hasVoted = votedPosts?.has(postId) ?? false
  const voteMutation = useVoteMutation()

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
      onError: () => {
        // Revert on error
        queryClient.setQueryData<number>(
          voteCountKeys.byPost(postId),
          (old) => (old ?? voteCount) + (newVoted ? -1 : 1)
        )
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
