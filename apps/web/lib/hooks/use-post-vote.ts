'use client'

import { useState, useTransition, useCallback } from 'react'

interface UsePostVoteOptions {
  postId: string
  initialVoteCount: number
  initialHasVoted: boolean
}

interface UsePostVoteReturn {
  voteCount: number
  hasVoted: boolean
  isPending: boolean
  handleVote: (e?: React.MouseEvent) => void
}

/**
 * Hook for managing post voting with optimistic updates.
 * Handles API calls, loading states, and rollback on error.
 */
export function usePostVote({
  postId,
  initialVoteCount,
  initialHasVoted,
}: UsePostVoteOptions): UsePostVoteReturn {
  const [voteCount, setVoteCount] = useState(initialVoteCount)
  const [hasVoted, setHasVoted] = useState(initialHasVoted)
  const [isPending, startTransition] = useTransition()

  const handleVote = useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        e.preventDefault()
        e.stopPropagation()
      }

      // Store previous state for rollback
      const previousVoteCount = voteCount
      const previousHasVoted = hasVoted

      // Optimistic update
      setHasVoted(!hasVoted)
      setVoteCount(hasVoted ? voteCount - 1 : voteCount + 1)

      startTransition(async () => {
        try {
          const response = await fetch(`/api/public/posts/${postId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })

          if (!response.ok) {
            throw new Error('Failed to vote')
          }

          const data = await response.json()
          setVoteCount(data.voteCount)
          setHasVoted(data.voted)
        } catch {
          // Revert on error
          setVoteCount(previousVoteCount)
          setHasVoted(previousHasVoted)
        }
      })
    },
    [postId, voteCount, hasVoted]
  )

  return {
    voteCount,
    hasVoted,
    isPending,
    handleVote,
  }
}
