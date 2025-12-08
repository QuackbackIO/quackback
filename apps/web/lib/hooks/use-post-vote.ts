'use client'

import { useState, useCallback } from 'react'
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
 * Two modes:
 * 1. With onVoteChange: Parent manages hasVoted state (for lists)
 * 2. Without onVoteChange: Local state manages hasVoted (for detail pages)
 */
export function usePostVote({
  postId,
  initialVoteCount,
  initialHasVoted,
  onVoteChange,
}: UsePostVoteOptions): UsePostVoteReturn {
  // Local state for optimistic updates
  const [localVoteCount, setLocalVoteCount] = useState(initialVoteCount)
  const [localHasVoted, setLocalHasVoted] = useState(initialHasVoted)

  // Use the React Query mutation for cache integration
  const voteMutation = useVoteMutation()

  // When parent manages state (onVoteChange provided), use props
  // Otherwise use local state
  const hasParentState = !!onVoteChange
  const currentHasVoted = hasParentState ? initialHasVoted : localHasVoted
  const currentVoteCount = hasParentState ? initialVoteCount : localVoteCount

  const handleVote = useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        e.preventDefault()
        e.stopPropagation()
      }

      // Calculate new state based on current state
      const newHasVoted = !currentHasVoted
      const newVoteCount = newHasVoted ? currentVoteCount + 1 : currentVoteCount - 1

      // Apply optimistic update
      if (hasParentState) {
        // Notify parent for list views
        onVoteChange(postId, newHasVoted)
      } else {
        // Update local state for detail views
        setLocalHasVoted(newHasVoted)
        setLocalVoteCount(newVoteCount)
      }

      // Trigger mutation
      voteMutation.mutate(postId, {
        onError: () => {
          // Revert on error
          if (hasParentState) {
            onVoteChange(postId, currentHasVoted)
          } else {
            setLocalHasVoted(currentHasVoted)
            setLocalVoteCount(currentVoteCount)
          }
        },
        onSuccess: (data) => {
          // Sync with server response
          if (hasParentState) {
            onVoteChange(postId, data.voted)
          } else {
            setLocalHasVoted(data.voted)
            setLocalVoteCount(data.voteCount)
          }
        },
      })
    },
    [postId, currentVoteCount, currentHasVoted, hasParentState, voteMutation, onVoteChange]
  )

  return {
    voteCount: currentVoteCount,
    hasVoted: currentHasVoted,
    isPending: voteMutation.isPending,
    handleVote,
  }
}
