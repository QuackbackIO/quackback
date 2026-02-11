import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { usePostVote } from '@/lib/client/hooks/use-post-vote'
import { cn } from '@/lib/shared/utils'
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
        'border-2 rounded-lg',
        compact ? 'flex-row gap-1 py-1 px-2 text-xs' : 'flex-col w-14 py-2',
        hasVoted
          ? 'bg-[var(--post-card-voted-color)]/10 border-[var(--post-card-voted-color)]/50 text-[var(--post-card-voted-color)]'
          : 'bg-muted/40 border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground/80',
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
          hasVoted && 'fill-[var(--post-card-voted-color)]',
          !isPending && !disabled && 'group-hover:-translate-y-0.5'
        )}
      />
      <span
        data-testid="vote-count"
        className={cn(
          'font-semibold tabular-nums',
          compact ? 'text-xs' : 'text-base',
          hasVoted ? 'text-[var(--post-card-voted-color)]' : 'text-foreground'
        )}
      >
        {voteCount}
      </span>
    </button>
  )
}
