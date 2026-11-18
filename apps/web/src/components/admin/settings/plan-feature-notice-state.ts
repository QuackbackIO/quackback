/**
 * When a paid feature's settings page carries the paused notice. A leaf, so
 * the page can ask without loading the notice's body.
 */

/** The query the notice and the pages that defer to it share. */
export const PLAN_FEATURE_NOTICE_QUERY_KEY = ['plan-limits', 'feature-notice'] as const

/** The part of the Plan limits page state the notice reads. */
export interface PlanNoticeState {
  enabled: boolean
  phase: 'ok' | 'grace' | 'enforced'
  planName: string | null
  graceEndsAt: string | null
  /** The last full day to fix, a plain YYYY-MM-DD date. */
  deadlineDay: string | null
  featureIssues: ReadonlyArray<{ key: string }>
  canManageBilling: boolean
}

/**
 * Whether the notice shows for `feature`: the rules are on, something is over
 * the plan, and this feature is set up past it, in the grace or after it.
 */
export function planFeatureNoticeApplies(
  feature: string,
  state: PlanNoticeState | null | undefined
): boolean {
  if (!state?.enabled || state.phase === 'ok') return false
  return state.featureIssues.some((issue) => issue.key === feature)
}
