'use client'

import { useState, useCallback, useEffect } from 'react'
import { useVoteMutation } from './use-public-posts-query'

interface UsePostVoteOptions {
  postId: string
  initialVoteCount: number
  initialHasVoted: boolean
  /** Callback when vote state changes - used to sync parent state */
  onVoteChange?: (postId: string, voted: boolean) => void
}

interface UsePostVoteReturn {
  voteCount: number
  hasVoted: boolean
  isPending: boolean
  handleVote: (e?: React.MouseEvent) => void
}

/**
 * Hook for managing post voting with optimistic updates via React Query.
 *
 * Always tracks vote count locally for immediate UI feedback.
 * When onVoteChange is provided, also notifies parent for hasVoted state sync.
 */
export function usePostVote({
  postId,
  initialVoteCount,
  initialHasVoted,
  onVoteChange,
}: UsePostVoteOptions): UsePostVoteReturn {
  // Local state for optimistic updates - always used for vote count
  const [localVoteCount, setLocalVoteCount] = useState(initialVoteCount)
  const [localHasVoted, setLocalHasVoted] = useState(initialHasVoted)

  // Sync local state when props change (e.g., from query cache updates)
  useEffect(() => {
    setLocalVoteCount(initialVoteCount)
  }, [initialVoteCount])

  useEffect(() => {
    setLocalHasVoted(initialHasVoted)
  }, [initialHasVoted])

  // Use the React Query mutation for cache integration
  const voteMutation = useVoteMutation()

  const handleVote = useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        e.preventDefault()
        e.stopPropagation()
      }

      // Calculate new state based on current local state
      const newHasVoted = !localHasVoted
      const newVoteCount = newHasVoted ? localVoteCount + 1 : localVoteCount - 1

      // Apply optimistic update locally
      setLocalHasVoted(newHasVoted)
      setLocalVoteCount(newVoteCount)

      // Also notify parent if callback provided (for hasVoted sync)
      if (onVoteChange) {
        onVoteChange(postId, newHasVoted)
      }

      // Trigger mutation
      voteMutation.mutate(postId, {
        onError: () => {
          // Revert local state on error
          setLocalHasVoted(localHasVoted)
          setLocalVoteCount(localVoteCount)
          // Also notify parent of revert
          if (onVoteChange) {
            onVoteChange(postId, localHasVoted)
          }
        },
        onSuccess: (data) => {
          // Sync with server response for accuracy
          setLocalHasVoted(data.voted)
          setLocalVoteCount(data.voteCount)
          // Also notify parent
          if (onVoteChange) {
            onVoteChange(postId, data.voted)
          }
        },
      })
    },
    [postId, localVoteCount, localHasVoted, voteMutation, onVoteChange]
  )

  return {
    voteCount: localVoteCount,
    hasVoted: localHasVoted,
    isPending: voteMutation.isPending,
    handleVote,
  }
}
