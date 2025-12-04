'use client'

import { useState, useTransition } from 'react'
import { ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VoteButtonProps {
  postId: string
  initialVoteCount: number
  initialHasVoted: boolean
  disabled?: boolean
}

export function VoteButton({
  postId,
  initialVoteCount,
  initialHasVoted,
  disabled = false,
}: VoteButtonProps) {
  const [voteCount, setVoteCount] = useState(initialVoteCount)
  const [hasVoted, setHasVoted] = useState(initialHasVoted)
  const [isPending, startTransition] = useTransition()

  const handleVote = () => {
    if (disabled) return

    // Optimistic update
    const previousVoteCount = voteCount
    const previousHasVoted = hasVoted

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
        setVoteCount(data.newCount)
        setHasVoted(data.voted)
      } catch {
        // Revert on error
        setVoteCount(previousVoteCount)
        setHasVoted(previousHasVoted)
      }
    })
  }

  return (
    <button
      type="button"
      className={cn(
        'flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors',
        hasVoted ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        isPending && 'opacity-70',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      onClick={handleVote}
      disabled={disabled || isPending}
    >
      <ChevronUp className={cn('h-6 w-6', hasVoted && 'fill-primary')} />
      <span className={cn('text-lg font-bold', hasVoted ? 'text-primary' : 'text-foreground')}>
        {voteCount}
      </span>
    </button>
  )
}
