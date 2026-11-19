import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'

/**
 * Whether the plan limits banner has something to say: the workspace is over
 * its plan and, after the date, some cap is still over. Paused features alone
 * leave each settings page its own line and the ended-trial strip in place.
 * Type-only imports, so the admin layout can ask without loading the banner.
 */
export function planLimitsBannerShows(
  limits: Pick<PlanLimitsPage, 'enabled' | 'phase' | 'issues'> | null | undefined
): boolean {
  if (!limits?.enabled) return false
  if (limits.phase === 'grace') return true
  return limits.phase === 'enforced' && limits.issues.length > 0
}
