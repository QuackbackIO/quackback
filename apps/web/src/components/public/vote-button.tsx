import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { usePostVote } from '@/lib/hooks/use-post-vote'
import { cn } from '@/lib/utils'
import type { PostId } from '@quackback/ids'

interface VoteButtonProps {
  postId: PostId
  voteCount: number
  disabled?: boolean
  /** Called when user tries to vote but isn't authenticated */
  onAuthRequired?: () => void
  /** Compact horizontal variant for inline use */
  compact?: boolean
}

export function VoteButton({
  postId,
  voteCount: initialVoteCount,
  disabled = false,
  onAuthRequired,
  compact = false,
}: VoteButtonProps): React.ReactElement {
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId,
    voteCount: initialVoteCount,
  })

  function handleClick(): void {
    if (disabled) {
      onAuthRequired?.()
      return
    }
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
        'group relative flex items-center justify-center transition-all duration-200 cursor-pointer',
        'border',
        compact
          ? 'flex-row gap-1 py-1 px-2 rounded-md text-xs'
          : 'flex-col py-3 px-4 rounded-xl border-2',
        hasVoted
          ? 'bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10'
          : 'bg-muted/30 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border/50',
        isPending && 'opacity-70 cursor-wait',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      onClick={handleClick}
      disabled={isPending}
    >
      <ChevronUpIcon
        className={cn(
          'transition-transform duration-200',
          compact ? 'h-3.5 w-3.5' : 'h-5 w-5',
          hasVoted && 'fill-primary',
          !isPending && !disabled && 'group-hover:-translate-y-0.5'
        )}
      />
      <span
        data-testid="vote-count"
        className={cn(
          'font-semibold tabular-nums',
          compact ? 'text-xs' : 'text-xl mt-0.5',
          hasVoted ? 'text-primary' : 'text-foreground'
        )}
      >
        {voteCount}
      </span>
    </button>
  )
}
