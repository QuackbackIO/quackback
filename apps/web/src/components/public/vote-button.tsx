import { useRef } from 'react'
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
  /** Async callback before voting (e.g. anonymous sign-in). Return false to cancel. */
  onBeforeVote?: () => Promise<boolean>
  /** Compact horizontal variant for inline use */
  compact?: boolean
  /** Static display with no interactivity */
  readonly?: boolean
}

export function VoteButton({
  postId,
  voteCount: initialVoteCount,
  disabled = false,
  onAuthRequired,
  onBeforeVote,
  compact = false,
  readonly = false,
}: VoteButtonProps): React.ReactElement {
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId,
    voteCount: initialVoteCount,
    enabled: !readonly,
  })

  const displayCount = readonly ? initialVoteCount : voteCount
  const isHandlingRef = useRef(false)

  async function handleClick(): Promise<void> {
    if (disabled) {
      onAuthRequired?.()
      return
    }
    if (isHandlingRef.current) return
    if (onBeforeVote) {
      isHandlingRef.current = true
      try {
        const proceed = await onBeforeVote()
        if (!proceed) return
      } finally {
        isHandlingRef.current = false
      }
    }
    handleVote()
  }

  const sharedClassName = cn(
    'relative flex items-center justify-center',
    'border rounded-md',
    compact ? 'flex-row gap-1 py-1.5 px-2.5 text-xs' : 'flex-col w-12 py-2 gap-0.5',
    'bg-muted/40 text-muted-foreground',
    !readonly && 'group transition-colors duration-200 cursor-pointer',
    !readonly &&
      (hasVoted
        ? 'border-post-card-voted/60 bg-post-card-voted/15 text-post-card-voted'
        : 'border-border/50 hover:border-border hover:bg-muted/60 hover:text-foreground/80'),
    readonly && 'border-border/50',
    !readonly && isPending && 'opacity-70 cursor-wait',
    !readonly && disabled && 'cursor-not-allowed opacity-50'
  )

  const chevron = (
    <ChevronUpIcon
      className={cn(
        compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
        !readonly && 'transition-transform duration-200',
        !readonly && hasVoted && 'fill-post-card-voted',
        !readonly && !isPending && !disabled && 'group-hover:-translate-y-0.5'
      )}
    />
  )

  const count = (
    <span
      data-testid="vote-count"
      className={cn(
        'font-semibold tabular-nums',
        compact ? 'text-xs' : 'text-sm',
        !readonly && hasVoted ? 'text-post-card-voted' : 'text-foreground'
      )}
    >
      {displayCount}
    </span>
  )

  if (readonly) {
    return (
      <div
        data-testid="vote-button"
        aria-label={`${displayCount} votes`}
        className={sharedClassName}
      >
        {chevron}
        {count}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-testid="vote-button"
      aria-label={
        hasVoted ? `Remove vote (${voteCount} votes)` : `Vote for this post (${voteCount} votes)`
      }
      aria-pressed={hasVoted}
      className={sharedClassName}
      onClick={handleClick}
      disabled={isPending}
    >
      {chevron}
      {count}
    </button>
  )
}
