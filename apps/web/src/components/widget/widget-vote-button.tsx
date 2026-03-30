import { useRef, useCallback } from 'react'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { useWidgetVote } from '@/lib/client/hooks/use-widget-vote'
import { useWidgetAuth } from './widget-auth-provider'
import { cn } from '@/lib/shared/utils'
import type { PostId } from '@featurepool/ids'

interface WidgetVoteButtonProps {
  postId: PostId
  voteCount: number
  /** Async callback before voting (e.g. anonymous sign-in). Return false to cancel. */
  onBeforeVote?: () => Promise<boolean>
  /** Called when an unauthenticated user clicks to vote (e.g. open portal). */
  onAuthRequired?: () => void
  /** Compact horizontal variant */
  compact?: boolean
}

export function WidgetVoteButton({
  postId,
  voteCount: initialVoteCount,
  onBeforeVote,
  onAuthRequired,
  compact = false,
}: WidgetVoteButtonProps) {
  const { sessionVersion } = useWidgetAuth()
  const { voteCount, hasVoted, isPending, handleVote } = useWidgetVote({
    postId,
    voteCount: initialVoteCount,
    sessionVersion,
  })

  const isHandlingRef = useRef(false)

  const handleClick = useCallback(async () => {
    if (onAuthRequired) {
      onAuthRequired()
      return
    }
    if (isHandlingRef.current || isPending) return
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
  }, [onAuthRequired, onBeforeVote, isPending, handleVote])

  return (
    <button
      type="button"
      aria-label={hasVoted ? `Remove vote (${voteCount} votes)` : `Vote (${voteCount} votes)`}
      aria-pressed={hasVoted}
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        'relative flex items-center justify-center border rounded-md',
        compact ? 'flex-row gap-1 py-1.5 px-2.5 text-xs' : 'flex-col w-12 py-2 gap-0.5',
        'group transition-colors duration-200 cursor-pointer',
        hasVoted
          ? 'border-post-card-voted/60 bg-post-card-voted/15 text-post-card-voted'
          : 'bg-muted/40 text-muted-foreground border-border/50 hover:border-border hover:bg-muted/60 hover:text-foreground/80',
        isPending && 'opacity-70 cursor-wait'
      )}
    >
      <ChevronUpIcon
        className={cn(
          compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
          'transition-transform duration-200',
          hasVoted && 'fill-post-card-voted',
          !isPending && 'group-hover:-translate-y-0.5'
        )}
      />
      <span
        className={cn(
          'font-semibold tabular-nums',
          compact ? 'text-xs' : 'text-sm',
          hasVoted ? 'text-post-card-voted' : 'text-foreground'
        )}
      >
        {voteCount}
      </span>
    </button>
  )
}
