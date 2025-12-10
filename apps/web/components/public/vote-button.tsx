'use client'

import { ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePostVote } from '@/lib/hooks/use-post-vote'

interface VoteButtonProps {
  postId: string
  initialVoteCount: number
  initialHasVoted: boolean
  disabled?: boolean
  /** Called when user tries to vote but isn't authenticated */
  onAuthRequired?: () => void
}

export function VoteButton({
  postId,
  initialVoteCount,
  initialHasVoted,
  disabled = false,
  onAuthRequired,
}: VoteButtonProps) {
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId,
    initialVoteCount,
    initialHasVoted,
  })

  const onClick = () => {
    if (disabled && onAuthRequired) {
      onAuthRequired()
      return
    }
    if (disabled) return
    handleVote()
  }

  return (
    <button
      type="button"
      data-testid="vote-button"
      className={cn(
        'flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors cursor-pointer',
        hasVoted ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        isPending && 'opacity-70',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      onClick={onClick}
      disabled={disabled || isPending}
    >
      <ChevronUp className={cn('h-6 w-6', hasVoted && 'fill-primary')} />
      <span
        data-testid="vote-count"
        className={cn('text-lg font-bold', hasVoted ? 'text-primary' : 'text-foreground')}
      >
        {voteCount}
      </span>
    </button>
  )
}
