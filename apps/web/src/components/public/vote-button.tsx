import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'
import { usePostVote } from '@/lib/hooks/use-post-vote'
import type { PostId } from '@quackback/ids'

interface VoteButtonProps {
  postId: PostId
  voteCount: number
  disabled?: boolean
  /** Called when user tries to vote but isn't authenticated */
  onAuthRequired?: () => void
}

export function VoteButton({
  postId,
  voteCount: initialVoteCount,
  disabled = false,
  onAuthRequired,
}: VoteButtonProps) {
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId,
    voteCount: initialVoteCount,
  })

  function onClick(): void {
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
      aria-label={
        hasVoted ? `Remove vote (${voteCount} votes)` : `Vote for this post (${voteCount} votes)`
      }
      aria-pressed={hasVoted}
      className={cn(
        'group flex flex-col items-center justify-center py-3 px-4 rounded-xl transition-all duration-200 cursor-pointer',
        'border-2',
        hasVoted
          ? 'bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10'
          : 'bg-muted/30 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border/50',
        isPending && 'opacity-70 cursor-wait',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      onClick={onClick}
      disabled={isPending}
    >
      <ChevronUpIcon
        className={cn(
          'h-5 w-5 transition-transform duration-200',
          hasVoted && 'fill-primary',
          !isPending && !disabled && 'group-hover:-translate-y-0.5'
        )}
      />
      <span
        data-testid="vote-count"
        className={cn(
          'text-xl font-bold tabular-nums mt-0.5',
          hasVoted ? 'text-primary' : 'text-foreground'
        )}
      >
        {voteCount}
      </span>
    </button>
  )
}
