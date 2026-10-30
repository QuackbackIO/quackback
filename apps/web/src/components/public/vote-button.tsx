import { useRef } from 'react'
import { useIntl } from 'react-intl'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { usePostVote } from '@/lib/client/hooks/use-post-vote'
import { cn } from '@/lib/shared/utils'
import { voteBoxClasses } from '@/components/shared/vote-box'
import type { PostId } from '@quackback/ids'

interface VoteButtonProps {
  postId: PostId
  voteCount: number
  /** Structurally disabled (e.g. merged post) — visually dimmed, no interaction */
  disabled?: boolean
  /** Called when unauthenticated user clicks — button looks normal, clicking triggers this */
  onAuthRequired?: () => void
  /**
   * Reason a signed-in viewer cannot vote (board tier — authz, not auth). When
   * set: the button is dimmed, clicking is a no-op, and the reason shows as a
   * hover tooltip ("You don't have access to vote on this board").
   */
  noAccessReason?: string
  /** Async callback before voting (e.g. anonymous sign-in). Return false to cancel. */
  onBeforeVote?: () => Promise<boolean>
  /** Compact horizontal variant for inline use */
  compact?: boolean
  /** Pill variant — vertical, self-stretches to parent height */
  pill?: boolean
  /** Static display with no interactivity */
  readonly?: boolean
}

export function VoteButton({
  postId,
  voteCount: initialVoteCount,
  disabled = false,
  onAuthRequired,
  onBeforeVote,
  noAccessReason,
  compact = false,
  pill = false,
  readonly = false,
}: VoteButtonProps): React.ReactElement {
  const intl = useIntl()
  const { voteCount, hasVoted, isPending, handleVote } = usePostVote({
    postId,
    voteCount: initialVoteCount,
    enabled: !readonly,
  })

  const displayCount = readonly ? initialVoteCount : voteCount
  const isHandlingRef = useRef(false)

  async function handleClick(): Promise<void> {
    if (disabled) return
    // Denied by the board tier for a signed-in viewer — the tooltip explains
    // why; do nothing (never fire a vote the server would reject).
    if (noAccessReason) return
    if (onAuthRequired) {
      onAuthRequired()
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

  const isInteractive = !readonly && !disabled && !noAccessReason

  const voteBox = voteBoxClasses({
    voted: isInteractive && hasVoted,
    interactive: isInteractive,
    size: compact ? 'compact' : pill ? 'pill' : 'default',
    pending: isInteractive && isPending,
    denied: Boolean(noAccessReason),
    disabled,
  })
  const sharedClassName = cn(voteBox.root, isInteractive && 'cursor-pointer')

  const chevron = <ChevronUpIcon className={voteBox.chevron} />

  const count = (
    <span data-testid="vote-count" className={voteBox.count}>
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
        hasVoted
          ? intl.formatMessage(
              {
                id: 'portal.postCard.vote.ariaRemoveVote',
                defaultMessage: 'Remove vote ({count, plural, one {# vote} other {# votes}})',
              },
              { count: voteCount }
            )
          : intl.formatMessage(
              {
                id: 'portal.postCard.vote.ariaVote',
                defaultMessage:
                  'Vote for this post ({count, plural, one {# vote} other {# votes}})',
              },
              { count: voteCount }
            )
      }
      aria-pressed={hasVoted}
      aria-disabled={noAccessReason ? true : undefined}
      title={noAccessReason}
      className={sharedClassName}
      onClick={handleClick}
      disabled={isPending}
    >
      {chevron}
      {count}
    </button>
  )
}
