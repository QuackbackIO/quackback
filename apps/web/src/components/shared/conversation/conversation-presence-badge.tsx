import { FormattedMessage } from 'react-intl'
import { cn } from '@/lib/shared/utils'

/**
 * The shared online/offline cue — a status dot plus "We're online" / "We'll
 * reply by email". Used by the conversation thread's presence strip and the support
 * surface's message CTA so the two never drift. Pass the precomputed `available`
 * verdict (see conversationAvailable); the caller owns the surrounding layout.
 */
export function ConversationPresenceBadge({
  available,
  backAt,
  className,
}: {
  available: boolean
  /** Pre-formatted "when we're back" label, shown after the away copy when
   *  office hours are configured — sets an honest expectation up front. */
  backAt?: string | null
  className?: string
}) {
  return (
    // min-w-0 down the chain: a flex item defaults to min-width:auto and
    // would grow past its container instead of letting `truncate` ellipsize.
    <span
      className={cn('flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          available ? 'bg-emerald-500' : 'bg-muted-foreground/40'
        )}
        aria-hidden
      />
      {available ? (
        <FormattedMessage id="widget.messenger.online" defaultMessage="We're online" />
      ) : (
        <span className="min-w-0 truncate">
          <FormattedMessage id="widget.messenger.offline" defaultMessage="We'll reply by email" />
          {backAt && (
            <span className="text-muted-foreground/70">
              {' · '}
              <FormattedMessage
                id="widget.messenger.offline.backAt"
                defaultMessage="Back {when}"
                values={{ when: backAt }}
              />
            </span>
          )}
        </span>
      )}
    </span>
  )
}
