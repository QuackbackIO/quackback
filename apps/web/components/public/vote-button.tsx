'use client'

import { useState, useTransition } from 'react'
import { ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <Button
      variant="outline"
      size="lg"
      className={cn(
        'flex flex-col items-center justify-center h-auto py-3 px-4 min-w-[60px]',
        hasVoted && 'bg-primary/10 border-primary text-primary hover:bg-primary/20',
        isPending && 'opacity-70'
      )}
      onClick={handleVote}
      disabled={disabled || isPending}
    >
      <ChevronUp className="h-5 w-5" />
      <span className="text-sm font-semibold">{voteCount}</span>
    </Button>
  )
}
