import { EyeSlashIcon } from '@heroicons/react/24/outline'
import { FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'

interface InlineModerationActionsProps {
  /** When false, nothing renders. */
  pending: boolean
  busy?: boolean
  onApprove?: () => void
  onReject?: () => void
  /** What is held. */
  noun: 'post' | 'comment'
  /**
   * The viewer is the item's author, not someone reviewing it: they are told
   * it waits for review, not that customers cannot see it.
   */
  forAuthor?: boolean
  className?: string
}

/**
 * Pending-review chrome + Approve/Reject, used wherever a held post or
 * comment already renders: for someone who can moderate it, and for its
 * author, who is the only other person shown a held item.
 */
export function InlineModerationActions({
  pending,
  busy = false,
  onApprove,
  onReject,
  noun,
  forAuthor = false,
  className,
}: InlineModerationActionsProps) {
  if (!pending) return null
  const canAct = Boolean(onApprove || onReject)
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5',
        className
      )}
    >
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <EyeSlashIcon className="h-3.5 w-3.5" />
        {forAuthor ? (
          <FormattedMessage
            id="portal.moderation.card.authorLabel"
            defaultMessage="Waiting for review"
          />
        ) : (
          <FormattedMessage
            id="portal.moderation.card.pendingLabel"
            defaultMessage="Pending approval"
          />
        )}
      </span>
      <span className="text-xs text-amber-700/80 dark:text-amber-500/70">
        <PendingNote noun={noun} forAuthor={forAuthor} />
      </span>
      {canAct && (
        <span className="ms-auto flex shrink-0 gap-1.5">
          {onApprove && (
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <FormattedMessage id="portal.moderation.card.approve" defaultMessage="Approve" />
            </Button>
          )}
          {onReject && (
            <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
              <FormattedMessage id="portal.moderation.card.reject" defaultMessage="Reject" />
            </Button>
          )}
        </span>
      )}
    </div>
  )
}

function PendingNote({ noun, forAuthor }: { noun: 'post' | 'comment'; forAuthor: boolean }) {
  if (forAuthor) {
    return noun === 'comment' ? (
      <FormattedMessage
        id="portal.moderation.card.authorNoteComment"
        defaultMessage="Only you can see this comment until the team reviews it."
      />
    ) : (
      <FormattedMessage
        id="portal.moderation.card.authorNote"
        defaultMessage="Only you can see this post until the team reviews it."
      />
    )
  }
  return noun === 'comment' ? (
    <FormattedMessage
      id="portal.moderation.card.hiddenNoteComment"
      defaultMessage="Customers cannot see this comment yet."
    />
  ) : (
    <FormattedMessage
      id="portal.moderation.card.hiddenNote"
      defaultMessage="Customers cannot see this post yet."
    />
  )
}
