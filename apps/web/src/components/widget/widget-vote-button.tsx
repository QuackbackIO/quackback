import { useRef, useCallback } from 'react'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { useIntl } from 'react-intl'
import { useWidgetVote } from '@/lib/client/hooks/use-widget-vote'
import { useWidgetAuth } from './widget-auth-provider'
import { cn } from '@/lib/shared/utils'
import type { PostId } from '@quackback/ids'

interface WidgetVoteButtonProps {
  postId: PostId
  voteCount: number
  /** Async callback before voting (e.g. anonymous sign-in). Return false to cancel. */
  onBeforeVote?: () => Promise<boolean>
  /** Called when an unauthenticated user clicks to vote (e.g. open portal). */
  onAuthRequired?: () => void
  /**
   * Reason an identified viewer cannot vote (board tier — authz, not auth).
   * When set: the button is dimmed, clicking is a no-op, and the reason shows
   * as a hover tooltip. Takes precedence over onAuthRequired.
   */
  noAccessReason?: string
  /** Compact horizontal variant */
  compact?: boolean
}

export function WidgetVoteButton({
  postId,
  voteCount: initialVoteCount,
  onBeforeVote,
  onAuthRequired,
  noAccessReason,
  compact = false,
}: WidgetVoteButtonProps) {
  const intl = useIntl()
  const { sessionVersion } = useWidgetAuth()
  const { voteCount, hasVoted, isPending, handleVote } = useWidgetVote({
    postId,
    voteCount: initialVoteCount,
    sessionVersion,
  })

  const isHandlingRef = useRef(false)

  const handleClick = useCallback(async () => {
    // Denied by the board tier for an identified viewer — the tooltip explains;
    // do nothing (never fire a vote the server would reject).
    if (noAccessReason) return
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
  }, [noAccessReason, onAuthRequired, onBeforeVote, isPending, handleVote])

  const ariaLabel = hasVoted
    ? intl.formatMessage(
        {
          id: 'widget.voteButton.ariaRemoveVote',
          defaultMessage: 'Remove vote ({count, plural, one {# vote} other {# votes}})',
        },
        { count: voteCount }
      )
    : intl.formatMessage(
        {
          id: 'widget.voteButton.ariaVote',
          defaultMessage: 'Vote ({count, plural, one {# vote} other {# votes}})',
        },
        { count: voteCount }
      )

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={hasVoted}
      aria-disabled={noAccessReason ? true : undefined}
      title={noAccessReason}
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        'relative flex items-center justify-center border rounded-md',
        compact ? 'flex-row gap-1 py-1.5 px-2.5 text-xs' : 'flex-col w-12 py-2 gap-0.5',
        'group transition-colors duration-200',
        !noAccessReason && 'cursor-pointer',
        hasVoted
          ? 'border-post-card-voted/60 bg-post-card-voted/15 text-post-card-voted'
          : 'bg-muted/40 text-muted-foreground border-border/50',
        // Hover affordances only when the button is actionable (not denied).
        !hasVoted &&
          !noAccessReason &&
          'hover:border-border hover:bg-muted/60 hover:text-foreground/80',
        isPending && 'opacity-70 cursor-wait',
        noAccessReason && 'cursor-not-allowed opacity-60'
      )}
    >
      <ChevronUpIcon
        className={cn(
          compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
          'transition-transform duration-200',
          hasVoted && 'fill-post-card-voted',
          !isPending && !noAccessReason && 'group-hover:-translate-y-0.5'
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
