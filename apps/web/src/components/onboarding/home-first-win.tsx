import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckCircleIcon, UserIcon } from '@heroicons/react/24/outline'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import type { FirstWinSummary } from '@/lib/server/domains/onboarding/first-win-summary'

/** The first win's heading: where focus goes when it arrives while someone is on Home. */
export const HOME_WIN_HEADING_ID = 'home-first-win'
/** The finished plan's row heading, for the same reason after Dismiss. */
export const HOME_PLAN_DONE_HEADING_ID = 'home-plan-done'

/** What the first win means for the goal, said as the outcome. */
const TITLE = {
  idea: { id: 'onboarding.win.title.idea', defaultMessage: 'Your first customer idea is in' },
  vote: { id: 'onboarding.win.title.vote', defaultMessage: 'Your first customer vote is in' },
  teamIdea: { id: 'onboarding.win.title.teamIdea', defaultMessage: 'Your team’s first idea is in' },
  conversation: {
    id: 'onboarding.win.title.conversation',
    defaultMessage: 'Your first conversation',
  },
  helpful: {
    id: 'onboarding.win.title.helpful',
    defaultMessage: 'A customer found your article helpful',
  },
  subscriber: { id: 'onboarding.win.title.subscriber', defaultMessage: 'Your first subscriber' },
} as const

const VIEW = {
  idea: { id: 'onboarding.win.view.idea', defaultMessage: 'View idea' },
  vote: { id: 'onboarding.win.view.idea', defaultMessage: 'View idea' },
  teamIdea: { id: 'onboarding.win.view.idea', defaultMessage: 'View idea' },
  conversation: { id: 'onboarding.win.view.conversation', defaultMessage: 'View conversation' },
  helpful: { id: 'onboarding.win.view.article', defaultMessage: 'See article' },
  subscriber: { id: 'onboarding.win.view.subscribers', defaultMessage: 'See subscribers' },
} as const

/**
 * Who acted, as the card names them: their name and company where known. A
 * signed-out visitor is named as one, so a generated name never reads as a
 * real person's.
 */
function useWho(summary: FirstWinSummary): string {
  const intl = useIntl()
  if (summary.visitor) {
    return summary.name
      ? intl.formatMessage(
          { id: 'onboarding.win.who.anonymous', defaultMessage: '{name} (an anonymous visitor)' },
          { name: summary.name }
        )
      : intl.formatMessage({
          id: 'onboarding.win.who.anonymousUnnamed',
          defaultMessage: 'An anonymous visitor',
        })
  }
  if (summary.name && summary.domain) {
    return intl.formatMessage(
      { id: 'onboarding.win.who.nameDomain', defaultMessage: '{name} from {domain}' },
      { name: summary.name, domain: summary.domain }
    )
  }
  if (summary.name) return summary.name
  if (summary.domain) {
    return intl.formatMessage(
      { id: 'onboarding.win.who.domain', defaultMessage: 'Someone from {domain}' },
      { domain: summary.domain }
    )
  }
  return summary.kind === 'teamIdea'
    ? intl.formatMessage({ id: 'onboarding.win.who.teammate', defaultMessage: 'A teammate' })
    : intl.formatMessage({ id: 'onboarding.win.who.customer', defaultMessage: 'A customer' })
}

/** Their picture or initials; a visitor gets a plain figure, never initials of a made-up name. */
function WinAvatar({ summary }: { summary: FirstWinSummary }) {
  if (summary.visitor || !summary.name) {
    return (
      <Avatar
        aria-hidden="true"
        className="size-10"
        fallback={<UserIcon className="size-5 text-muted-foreground" />}
      />
    )
  }
  return (
    <Avatar
      aria-hidden="true"
      src={summary.avatarUrl}
      name={summary.name}
      className="size-10 text-sm font-medium"
    />
  )
}

function WhoLine({ summary }: { summary: FirstWinSummary }) {
  const intl = useIntl()
  const who = useWho(summary)
  const votes = summary.votes
    ? intl.formatMessage(
        {
          id: 'onboarding.win.votes',
          defaultMessage: '{count, plural, one {# vote} other {# votes}}',
        },
        { count: summary.votes }
      )
    : null
  return <p className="text-sm text-muted-foreground">{[who, votes].filter(Boolean).join(' · ')}</p>
}

/**
 * Home's celebration once someone outside the team acts: the outcome for the
 * goal, who it was, their idea, article or message in their words, and the
 * one way to see it.
 */
export function HomeFirstWin({
  summary,
  pending,
  onDismiss,
}: {
  summary: FirstWinSummary | null
  pending: boolean
  onDismiss: () => void
}) {
  const intl = useIntl()
  return (
    <section
      lang={intl.locale}
      aria-labelledby={HOME_WIN_HEADING_ID}
      data-home-card="first-win"
      className="rounded-panel border border-border bg-card p-5 [--ring:var(--muted-foreground)]"
    >
      <div className="flex gap-4">
        {summary ? <WinAvatar summary={summary} /> : null}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h2
              id={HOME_WIN_HEADING_ID}
              tabIndex={-1}
              className="text-lg font-semibold text-pretty outline-none"
            >
              {summary ? (
                <FormattedMessage {...TITLE[summary.kind]} />
              ) : (
                <FormattedMessage
                  id="onboarding.win.generic"
                  defaultMessage="Your first customer is here"
                />
              )}
            </h2>
            {summary ? <WhoLine summary={summary} /> : null}
          </div>
          {summary?.subject ? (
            <blockquote className="border-s-2 border-border ps-3 text-[15px] font-medium break-words">
              {summary.subject}
            </blockquote>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {summary ? (
              <Button asChild size="sm">
                <Link to={summary.href}>
                  <FormattedMessage {...VIEW[summary.kind]} />
                </Link>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" disabled={pending} onClick={onDismiss}>
              <FormattedMessage id="onboarding.home.dismiss" defaultMessage="Dismiss" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Home's quiet line once the launch plan is done, while optional steps are
 * still open: it leads to the Launch plan page, where they are.
 */
export function HomePlanDone({ optional }: { optional: number }) {
  return (
    <section
      aria-labelledby={HOME_PLAN_DONE_HEADING_ID}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-muted-foreground [--ring:var(--muted-foreground)]"
    >
      <CheckCircleIcon className="size-4 shrink-0" aria-hidden="true" />
      <h2
        id={HOME_PLAN_DONE_HEADING_ID}
        tabIndex={-1}
        className="font-medium text-foreground outline-none"
      >
        <FormattedMessage id="onboarding.home.planDone" defaultMessage="Launch plan done." />
      </h2>{' '}
      <Link
        to="/admin/getting-started"
        className="underline underline-offset-2 hover:text-foreground"
      >
        <FormattedMessage
          id="onboarding.home.planDoneSteps"
          defaultMessage="{count, plural, one {# optional step} other {# optional steps}}"
          values={{ count: optional }}
        />
      </Link>
    </section>
  )
}
