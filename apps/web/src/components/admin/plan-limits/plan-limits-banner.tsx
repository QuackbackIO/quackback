import { useQuery } from '@tanstack/react-query'
import { ExclamationCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { useRouterState } from '@tanstack/react-router'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import { planLimitsQueries } from '@/lib/client/queries/plan-limits'
import {
  isPlanLimitsOver,
  planLimitsBannerCopy,
  planLimitsDateOptions,
  planLimitsShownDay,
} from '@/lib/shared/billing/plan-limits-copy'
import { useLocalDateFormatter } from '@/components/ui/local-date'
import { cn } from '@/lib/shared/utils'
import { PLAN_LIMITS_PATH } from '@/lib/shared/billing/plan-limits-path'
import {
  planLimitsIssueCount,
  planLimitsLink,
  type PlanLimitsBannerLimits,
} from '@/lib/shared/billing/plan-limits-shown'
import type { PlanLimitsNotice } from '@/lib/server/domains/plan-limits/plan-limits.notice'

/**
 * A deadline in a heading: "Mon, Nov 23". A deadline reads as a day, never as
 * a duration. Plan limits days are plain calendar dates, formatted in UTC.
 */
export const DEADLINE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
}

/** A deadline inside a sentence: "Nov 23" (see `planLimitsDateOptions` for the year). */
export const INLINE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
}

type BannerLimits = PlanLimitsBannerLimits

/**
 * The strip over every admin page while the workspace is over its plan:
 * amber with the date during grace, red once something is paused. Hidden on
 * the Plan limits page itself, which says it all.
 */
export function PlanLimitsBanner(props: {
  limits: BannerLimits | null | undefined
  pathname: string
}) {
  const format = useLocalDateFormatter()
  const { limits } = props
  if (!limits || props.pathname === PLAN_LIMITS_PATH) return null
  const day = planLimitsShownDay(limits)
  const copy = planLimitsBannerCopy(
    limits,
    format(day, planLimitsDateOptions(day, INLINE_DATE_FORMAT))
  )
  if (!copy) return null
  const enforced = copy.tone === 'enforced'
  const link = planLimitsLink(limits)
  // Amber with warning accents during grace, as the urgent plan notice is;
  // the destructive tint once something is paused.
  const Icon = enforced ? ExclamationCircleIcon : ExclamationTriangleIcon
  return (
    <div
      data-plan-limits-banner={copy.tone}
      className={cn(
        'flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm',
        enforced ? 'bg-destructive/15 border-destructive/40' : 'bg-warning/10 border-warning/40'
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Icon
          aria-hidden
          data-plan-limits-icon=""
          className={cn('size-4 shrink-0', enforced ? 'text-destructive' : 'text-warning')}
        />
        <span className="shrink-0 font-medium text-foreground">{copy.title}</span>
        <span className="text-muted-foreground">{copy.body}</span>
      </div>
      {link ? (
        <a
          href={link.href}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground',
            enforced
              ? 'text-foreground decoration-destructive/60'
              : 'text-warning decoration-warning/60'
          )}
        >
          {link.label}
        </a>
      ) : null}
    </div>
  )
}

/**
 * The same state, quietly, in the sidebar footer: the plan with what is left
 * to fix, and the date. Shown whenever the banner would be.
 */
export function PlanLimitsQuiet(props: { limits: BannerLimits | null | undefined }) {
  const format = useLocalDateFormatter()
  const { limits } = props
  if (!limits || !isPlanLimitsOver(limits) || !limits.graceEndsAt) return null
  const count = planLimitsIssueCount(limits)
  if (limits.phase === 'enforced' && count === 0) return null
  const plan = limits.planName ? `${limits.planName} plan` : 'Your plan'
  const day = planLimitsShownDay(limits)
  const date = format(day, planLimitsDateOptions(day, INLINE_DATE_FORMAT))
  const link = planLimitsLink(limits)
  const text = (
    <>
      <span className="block truncate font-medium text-foreground">
        {count > 0 ? `${plan} · ${count} ${count === 1 ? 'issue' : 'issues'}` : plan}
      </span>
      <span className="block truncate">
        {limits.phase === 'grace' ? `Fix by ${date}` : `Paused since ${date}`}
      </span>
    </>
  )
  return link ? (
    <a
      href={link.href}
      data-plan-limits-quiet={limits.phase}
      className="mb-1 block rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
    >
      {text}
    </a>
  ) : (
    <p
      data-plan-limits-quiet={limits.phase}
      className="mb-1 px-3 py-1 text-xs text-muted-foreground"
    >
      {text}
    </p>
  )
}

/** The state the admin loader read: the summary, or the notice without `member.view`. */
export type PlanLimitsInitial = PlanLimitsPage | PlanLimitsNotice

/**
 * The state the admin loader read, kept fresh by its query: a chooser
 * invalidates it, so the banner and the sidebar line tick down at once. A
 * viewer without `member.view` reads the narrowed notice under its own key.
 * Only mounted with plan billing on (see `routes/admin.tsx`).
 */
function useLiveLimits(initial: PlanLimitsInitial): PlanLimitsInitial {
  const { data } = useQuery({
    ...planLimitsQueries.banner('canViewPage' in initial),
    initialData: initial,
    retry: false,
  })
  return data ?? initial
}

/** The banner, live. The default export, for the admin layout's lazy import. */
export default function PlanLimitsStrip(props: { initial: PlanLimitsInitial }) {
  const limits = useLiveLimits(props.initial)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return <PlanLimitsBanner limits={limits} pathname={pathname} />
}

/** The sidebar line, live. */
export function PlanLimitsQuietLive(props: { initial: PlanLimitsInitial }) {
  return <PlanLimitsQuiet limits={useLiveLimits(props.initial)} />
}
