import { FormattedMessage, useIntl } from 'react-intl'
import { LocalDate } from '@/components/ui/local-date'
import { cn } from '@/lib/shared/utils'

const BACK_AT: Intl.DateTimeFormatOptions = { weekday: 'long', hour: 'numeric', minute: '2-digit' }

/**
 * When the team is back, e.g. "Monday 9:00 AM": in the visitor's language,
 * and in their time zone once hydrated. Nothing for a missing or invalid time.
 */
export function BackAtTime({ at }: { at: string | null | undefined }) {
  const intl = useIntl()
  return <LocalDate date={at} options={BACK_AT} locale={intl.locale} />
}

/** Whether `at` is a time `BackAtTime` can show. */
export function hasBackAtTime(at: string | null | undefined): at is string {
  return !!at && !Number.isNaN(new Date(at).getTime())
}

/**
 * The shared online/offline cue — a status dot plus "We're online" / "We'll
 * reply by email". Used by the conversation thread's presence strip and the support
 * surface's message CTA so the two never drift. Pass the precomputed `available`
 * verdict (see conversationAvailable); the caller owns the surrounding layout.
 */
export function ConversationPresenceBadge({
  available,
  nextOpenAt,
  className,
}: {
  available: boolean
  /** When the team is back (ISO), shown after the away copy when office hours
   *  are configured: it sets an honest expectation up front. */
  nextOpenAt?: string | null
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
          {hasBackAtTime(nextOpenAt) && (
            <span className="text-muted-foreground/70">
              {' · '}
              <FormattedMessage
                id="widget.messenger.offline.backAt"
                defaultMessage="Back {when}"
                values={{ when: <BackAtTime at={nextOpenAt} /> }}
              />
            </span>
          )}
        </span>
      )}
    </span>
  )
}
