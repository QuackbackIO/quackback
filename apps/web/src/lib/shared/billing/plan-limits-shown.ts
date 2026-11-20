import type { PlanLimitsNotice } from '@/lib/server/domains/plan-limits/plan-limits.notice'
import { PLAN_LIMITS_PATH } from './plan-limits-path'

/**
 * What the banner and the sidebar line read: the summary, or the notice for
 * a teammate without `member.view`, which withholds the team's counts and
 * marks the Plan limits page as closed to them.
 */
export type PlanLimitsBannerLimits = Pick<
  PlanLimitsNotice,
  | 'enabled'
  | 'phase'
  | 'graceEndsAt'
  | 'deadlineDay'
  | 'issues'
  | 'featureIssues'
  | 'planName'
  | 'fromPlanName'
  | 'canManageBilling'
> & { withheldIssues?: PlanLimitsNotice['withheldIssues']; canViewPage?: boolean }

/** Every cap over, including those whose counts the viewer does not get. */
export function planLimitsIssueCount(
  limits: Pick<PlanLimitsBannerLimits, 'issues' | 'withheldIssues'>
): number {
  return limits.issues.length + (limits.withheldIssues?.length ?? 0)
}

/**
 * Whether the plan limits banner has something to say: the workspace is over
 * its plan and, after the date, some cap is still over. Paused features alone
 * leave each settings page its own line and the ended-trial strip in place.
 * The admin layout inlines the same rule, so its pages load no extra chunk.
 */
export function planLimitsBannerShows(
  limits:
    | Pick<PlanLimitsBannerLimits, 'enabled' | 'phase' | 'issues' | 'withheldIssues'>
    | null
    | undefined
): boolean {
  if (!limits?.enabled) return false
  if (limits.phase === 'grace') return true
  return limits.phase === 'enforced' && planLimitsIssueCount(limits) > 0
}

/**
 * Where the banner and the sidebar line send this viewer: the Plan limits
 * page, or the plans for a billing manager who cannot open it. Null for
 * someone who can do neither; the banner asks them to ask instead.
 */
export function planLimitsLink(
  limits: Pick<PlanLimitsBannerLimits, 'canViewPage' | 'canManageBilling'>
): { label: string; href: string } | null {
  if (limits.canViewPage !== false) return { label: 'Review issues', href: PLAN_LIMITS_PATH }
  return limits.canManageBilling
    ? { label: 'Compare plans', href: '/admin/settings/billing' }
    : null
}
