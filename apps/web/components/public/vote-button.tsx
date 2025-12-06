'use client'

import { ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePostVote } from '@/lib/hooks/use-post-vote'

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
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId,
    initialVoteCount,
    initialHasVoted,
  })

  const onClick = () => {
    if (disabled) return
    handleVote()
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
      onClick={onClick}
      disabled={disabled || isPending}
    >
      <ChevronUp className={cn('h-6 w-6', hasVoted && 'fill-primary')} />
      <span className={cn('text-lg font-bold', hasVoted ? 'text-primary' : 'text-foreground')}>
        {voteCount}
      </span>
    </button>
  )
}
