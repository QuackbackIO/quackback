import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { FormattedMessage } from 'react-intl'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { isQuietTrial, presentPlanNotice } from '@/lib/shared/plan-notice'
import { LocalDate } from '@/components/ui/local-date'

/**
 * "Mon, Oct 12, 2:00 PM BST": the copy around it is English. The zone is named
 * because the first render is in UTC until the page hydrates.
 */
export const CHOICE_DUE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
}

interface PlanNoticeBannerProps {
  notice: PlanNotice | null
}

/**
 * Self-host operator strip, or a cloud trial countdown derived from the
 * billing projection. Not dismissible: an ended product trial stays until
 * they pick a plan.
 */
export function PlanNoticeBanner({ notice }: PlanNoticeBannerProps) {
  const view = presentPlanNotice(notice)
  // A trial with days to spare is a quiet line in the sidebar, not a banner.
  if (!view || isQuietTrial(view)) return null

  // Red only for someone who can act on it. A teammate who cannot choose a
  // plan gets the same news as a quiet strip, not an alarm with no way out.
  const ended = view.ended && Boolean(view.actionUrl)
  const tone = ended
    ? 'bg-red-600 text-white border-red-700'
    : view.ended
      ? 'bg-muted/60 border-border'
      : view.urgent
        ? 'bg-amber-500/10 border-amber-500/20'
        : 'bg-primary/5 border-primary/10'
  const muted = ended ? 'text-white/80' : 'text-muted-foreground'
  const actionClass = ended
    ? 'inline-flex items-center gap-1 font-medium text-white underline underline-offset-2 hover:text-white'
    : 'inline-flex items-center gap-1 text-primary font-medium hover:underline'

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm border-b ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
        <span className={`font-medium shrink-0 ${ended ? 'text-white' : 'text-foreground'}`}>
          {view.label}
        </span>
        {!view.ended && view.daysLeft !== null && (
          <>
            <span className="text-muted-foreground">·</span>
            <span
              className={
                view.urgent
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : 'text-muted-foreground'
              }
            >
              {view.daysLeft === 0
                ? 'ends today'
                : `${view.daysLeft} day${view.daysLeft === 1 ? '' : 's'} left`}
            </span>
          </>
        )}
        {ended && view.choiceDueAt && <ChoiceDue at={view.choiceDueAt} />}
        {view.message && (
          // A strip with no button has nothing but its message to say, so it
          // keeps it on a phone too.
          <span className={`${muted} ${view.actionUrl ? 'hidden sm:inline truncate' : ''}`}>
            {view.message}
          </span>
        )}
      </div>
      {view.actionUrl && (
        <a
          href={view.actionUrl}
          {...(view.actionUrl.startsWith('/')
            ? {}
            : { target: '_blank', rel: 'noopener noreferrer' })}
          className={`${actionClass} shrink-0`}
        >
          {view.actionLabel ?? 'Manage'}
          {!view.actionUrl.startsWith('/') && <ArrowTopRightOnSquareIcon className="h-3 w-3" />}
        </a>
      )}
    </div>
  )
}

/** When the rest of admin starts waiting on a plan choice, in the viewer's own time. */
function ChoiceDue({ at }: { at: Date }) {
  return (
    <>
      <span className="text-white/80">·</span>
      <span className="font-medium text-white">
        Choose by <LocalDate date={at} options={CHOICE_DUE_FORMAT} locale="en-US" />
      </span>
    </>
  )
}

/** A running trial's days, quietly, in the sidebar footer until its last three. */
export function PlanNoticeQuiet({ notice }: PlanNoticeBannerProps) {
  const view = presentPlanNotice(notice)
  if (!view || !isQuietTrial(view)) return null
  const text = view.trialPlan ? (
    <FormattedMessage
      id="onboarding.trial.quietPlan"
      defaultMessage="{plan} trial · {days, plural, one {# day} other {# days}}"
      values={{ plan: view.trialPlan, days: view.daysLeft }}
    />
  ) : (
    <FormattedMessage
      id="onboarding.trial.quiet"
      defaultMessage="{label} · {days, plural, one {# day} other {# days}}"
      values={{ label: view.label, days: view.daysLeft }}
    />
  )
  return view.actionUrl?.startsWith('/') ? (
    <a
      href={view.actionUrl}
      className="mb-1 block truncate rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
    >
      {text}
    </a>
  ) : (
    <p className="mb-1 truncate px-3 py-1 text-xs text-muted-foreground">{text}</p>
  )
}
