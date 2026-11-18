import { useQuery } from '@tanstack/react-query'
import { FormattedDate, FormattedMessage } from 'react-intl'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import { planLimitsQueries } from '@/lib/client/queries/plan-limits'
import { isPlanLimitsOver, planLimitsBannerCopy } from '@/lib/shared/billing/plan-limits-copy'
import { useBillingEnabled } from '@/lib/client/hooks/use-root-context'
import { useLocalDateFormatter } from '@/components/ui/local-date'
import { cn } from '@/lib/shared/utils'

export const PLAN_LIMITS_PATH = '/admin/settings/billing/limits'

/** "Tue 25 Nov": a deadline reads as a day, never as a duration. */
export const DEADLINE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
}

type BannerLimits = Pick<
  PlanLimitsPage,
  | 'enabled'
  | 'phase'
  | 'graceEndsAt'
  | 'issues'
  | 'featureIssues'
  | 'planName'
  | 'fromPlanName'
  | 'canManageBilling'
>

/**
 * The plan limits state, for every admin, while billing is on. Undefined until
 * it loads and when it cannot be read, so a failure shows nothing.
 */
export function usePlanLimitsSummary(): PlanLimitsPage | undefined {
  const billingEnabled = useBillingEnabled()
  const { data } = useQuery({
    ...planLimitsQueries.summary(),
    enabled: Boolean(billingEnabled),
    retry: false,
  })
  return data ?? undefined
}

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
  const copy = planLimitsBannerCopy(limits, format(limits.graceEndsAt, DEADLINE_FORMAT))
  if (!copy) return null
  return (
    <div
      data-plan-limits-banner={copy.tone}
      className={cn(
        'flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm',
        copy.tone === 'enforced'
          ? 'bg-destructive/15 border-destructive/40'
          : 'bg-warning/10 border-warning/40'
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-medium text-foreground">{copy.title}</span>
        <span className="text-muted-foreground">{copy.body}</span>
      </div>
      <a
        href={PLAN_LIMITS_PATH}
        className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
      >
        {copy.action}
      </a>
    </div>
  )
}

/**
 * The same state, quietly, in the sidebar footer: the plan with what is left
 * to fix, and the date. Shown whenever the banner would be.
 */
export function PlanLimitsQuiet(props: { limits: BannerLimits | null | undefined }) {
  const { limits } = props
  if (!limits || !isPlanLimitsOver(limits) || !limits.graceEndsAt) return null
  if (limits.phase === 'enforced' && limits.issues.length === 0) return null
  const count = limits.issues.length
  const plan = limits.planName ?? ''
  const date = <FormattedDate value={limits.graceEndsAt} {...DEADLINE_FORMAT} />
  return (
    <a
      href={PLAN_LIMITS_PATH}
      data-plan-limits-quiet={limits.phase}
      className="mb-1 block rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
    >
      <span className="block truncate font-medium text-foreground">
        {count > 0 ? (
          <FormattedMessage
            id="admin.planLimits.quiet.toFix"
            defaultMessage="{plan} plan · {count} to fix"
            values={{ plan, count }}
          />
        ) : (
          <FormattedMessage
            id="admin.planLimits.quiet.plan"
            defaultMessage="{plan} plan"
            values={{ plan }}
          />
        )}
      </span>
      <span className="block truncate">
        {limits.phase === 'grace' ? (
          <FormattedMessage
            id="admin.planLimits.quiet.fixBy"
            defaultMessage="Fix by {date}"
            values={{ date }}
          />
        ) : (
          <FormattedMessage
            id="admin.planLimits.quiet.paused"
            defaultMessage="Paused since {date}"
            values={{ date }}
          />
        )}
      </span>
    </a>
  )
}
