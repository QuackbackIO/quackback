import { FormattedMessage } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { resolveReplyTime, type ReplyTime } from '@/lib/shared/widget/reply-time'
import { BackAtTime, hasBackAtTime } from './back-at-time'
import { headerReplyTimeMessages } from './reply-time-messages'
import { TeamFacepile, type TeamFace } from './team-facepile'

/**
 * Who the visitor is talking to and when to expect a reply: up to three
 * teammates, the team name, and a status line. The line reads "Online now"
 * while the team is available (see conversationAvailable). Away, it always
 * keeps the reply promise ("We'll reply by email" / "We'll reply here"),
 * led by when the team is back when office hours say it is closed, else by
 * the workspace's usual reply time unless that is hidden. Used by the
 * widget's messenger top bar and the thread's own header so the two never
 * drift.
 */
export function ConversationTeamHeader({
  team,
  teamName,
  available,
  replyTime,
  canReplyByEmail,
  nextOpenAt,
  ringClassName = 'ring-background',
  className,
}: {
  team: TeamFace[]
  teamName: string | null
  available: boolean
  /** The messenger's usual reply time; absent reads as under an hour. */
  replyTime?: ReplyTime
  /** Whether a reply can reach this visitor by email (the server's
   *  `canEmailVisitor`). Only then does the away copy promise email: an
   *  anonymous visitor has no real address, so it never does. */
  canReplyByEmail: boolean
  /** When the team is back (ISO), shown after the away line. */
  nextOpenAt?: string | null
  /** Ring colour matching the surface behind the avatars. */
  ringClassName?: string
  className?: string
}) {
  const expectation = resolveReplyTime(replyTime)
  const faces = team.slice(0, 3)
  return (
    // min-w-0 down the chain: a flex item defaults to min-width:auto and
    // would grow past its container instead of letting text truncate or wrap.
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {faces.length > 0 && <TeamFacepile faces={faces} ringClassName={ringClassName} />}
      <div className="min-w-0">
        {teamName && (
          <p className="truncate text-sm font-semibold leading-tight text-foreground">{teamName}</p>
        )}
        <p className="flex min-w-0 items-start gap-1.5 text-[11px] leading-tight text-muted-foreground">
          <span
            className={cn(
              // Centred on the first line: (13.75px line - 6px dot) / 2.
              'mt-1 size-1.5 shrink-0 rounded-full',
              available ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            )}
            aria-hidden
          />
          {/* Wraps to a second line rather than cutting off the reply promise. */}
          <span data-slot="team-status" className="min-w-0 line-clamp-2">
            {available ? (
              <FormattedMessage
                id="widget.messenger.header.onlineNow"
                defaultMessage="Online now"
              />
            ) : (
              <>
                {/* Closed for the day: when the team is back, no reply time
                    claim. Otherwise the usual reply time, unless hidden. */}
                {hasBackAtTime(nextOpenAt) ? (
                  <>
                    <FormattedMessage
                      id="widget.messenger.offline.backAt"
                      defaultMessage="Back {when}"
                      values={{ when: <BackAtTime at={nextOpenAt} /> }}
                    />
                    {' · '}
                  </>
                ) : expectation !== 'off' ? (
                  <>
                    <FormattedMessage {...headerReplyTimeMessages[expectation]} />
                    {' · '}
                  </>
                ) : null}
                {canReplyByEmail ? (
                  <FormattedMessage
                    id="widget.messenger.offline"
                    defaultMessage="We'll reply by email"
                  />
                ) : (
                  <FormattedMessage
                    id="widget.messenger.offline.replyHere"
                    defaultMessage="We'll reply here"
                  />
                )}
              </>
            )}
          </span>
        </p>
      </div>
    </div>
  )
}
