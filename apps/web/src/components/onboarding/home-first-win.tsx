import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import type { FirstWinSummary } from '@/lib/server/domains/onboarding/first-win-summary'
import type { LaunchTask } from '@/lib/shared/launch-checklist'
import { LaunchTaskLabel } from './launch-task-label'
import { LaunchTaskLink } from './launch-task-link'

const TITLE = {
  idea: { id: 'onboarding.win.idea', defaultMessage: '{who} posted an idea' },
  teamIdea: { id: 'onboarding.win.teamIdea', defaultMessage: '{who} posted the first team idea' },
  conversation: {
    id: 'onboarding.win.conversation',
    defaultMessage: '{who} started a conversation',
  },
  helpful: { id: 'onboarding.win.helpful', defaultMessage: '{who} found an article helpful' },
  subscriber: {
    id: 'onboarding.win.subscriber',
    defaultMessage: '{who} subscribed to your status page',
  },
} as const

const VIEW = {
  idea: { id: 'onboarding.win.view.idea', defaultMessage: 'View idea' },
  teamIdea: { id: 'onboarding.win.view.idea', defaultMessage: 'View idea' },
  conversation: { id: 'onboarding.win.view.conversation', defaultMessage: 'View conversation' },
  helpful: { id: 'onboarding.win.view.article', defaultMessage: 'See article' },
  subscriber: { id: 'onboarding.win.view.subscribers', defaultMessage: 'See subscribers' },
} as const

/** Who acted, as the card names them: their name and company where known. */
function useWho(summary: FirstWinSummary): string {
  const intl = useIntl()
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

function WinTitle({ summary }: { summary: FirstWinSummary }) {
  const who = useWho(summary)
  return <FormattedMessage {...TITLE[summary.kind]} values={{ who }} />
}

/**
 * Home's celebration once someone outside the team acts: who, on what, a link
 * to it, and the next step, so the plan hands over instead of just ending.
 */
export function HomeFirstWin({
  summary,
  next,
  pending,
  onDismiss,
}: {
  summary: FirstWinSummary | null
  /** The next open step, handed over now the path is done. */
  next: LaunchTask | null
  pending: boolean
  onDismiss: () => void
}) {
  const intl = useIntl()
  const line = summary
    ? [
        summary.subject,
        summary.votes
          ? intl.formatMessage(
              {
                id: 'onboarding.win.votes',
                defaultMessage: '{count, plural, one {# vote} other {# votes}}',
              },
              { count: summary.votes }
            )
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  return (
    <section
      lang={intl.locale}
      aria-label={intl.formatMessage({ id: 'onboarding.win.region', defaultMessage: 'First win' })}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border bg-card p-4 shadow-raise [--ring:var(--muted-foreground)]"
    >
      <div className="min-w-[min(14rem,100%)] flex-1 space-y-1">
        <p className="text-sm font-semibold">
          {summary ? (
            <WinTitle summary={summary} />
          ) : (
            <FormattedMessage
              id="onboarding.win.generic"
              defaultMessage="Your first customer is here"
            />
          )}
        </p>
        {line ? <p className="truncate text-sm text-muted-foreground">{line}</p> : null}
        {next ? (
          <p className="text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.win.next"
              defaultMessage="Next: {step}"
              values={{
                step: (
                  <LaunchTaskLink
                    task={next}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    <LaunchTaskLabel task={next} />
                  </LaunchTaskLink>
                ),
              }}
            />
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
    </section>
  )
}
