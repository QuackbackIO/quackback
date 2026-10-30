import { useRef, useCallback } from 'react'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { useIntl } from 'react-intl'
import { useWidgetVote } from '@/lib/client/hooks/use-widget-vote'
import { useWidgetAuth } from './widget-auth-provider'
import { cn } from '@/lib/shared/utils'
import { voteBoxClasses } from '@/components/shared/vote-box'
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
  const voteBox = voteBoxClasses({
    voted: hasVoted,
    interactive: true,
    size: compact ? 'compact' : 'default',
    pending: isPending,
    denied: Boolean(noAccessReason),
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
      data-testid="vote-button"
      aria-label={ariaLabel}
      aria-pressed={hasVoted}
      aria-disabled={noAccessReason ? true : undefined}
      title={noAccessReason}
      onClick={handleClick}
      disabled={isPending}
      className={cn(voteBox.root, !noAccessReason && 'cursor-pointer')}
    >
      <ChevronUpIcon className={voteBox.chevron} />
      <span className={voteBox.count}>{voteCount}</span>
    </button>
  )
}
