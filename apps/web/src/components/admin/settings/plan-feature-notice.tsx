/**
 * Whether a paid feature's settings page carries the paused notice, for a
 * page whose own upgrade box would otherwise say the same thing twice.
 *
 * Each page renders the notice itself: it checks the plan limits flag and only
 * then loads `plan-feature-notice-body`. That check lives in each route rather
 * than here, because a module shared by the routes becomes a chunk of its own
 * and costs every one of them a request even with the flag off.
 */
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import type { PlanNoticeFeature } from './plan-feature-notice-body'
import {
  PLAN_FEATURE_NOTICE_QUERY_KEY,
  planFeatureNoticeApplies,
} from './plan-feature-notice-state'

/**
 * Whether the page carries the paused notice for `feature`. Shares the
 * notice's query; with the flag off it runs nothing and answers false.
 */
export function usePlanFeatureNoticeShown(feature: PlanNoticeFeature): boolean {
  const enabled = useWorkspaceSettings()?.featureFlags?.planLimits === true
  const { data } = useQuery({
    queryKey: PLAN_FEATURE_NOTICE_QUERY_KEY,
    queryFn: async () => (await import('@/lib/server/functions/plan-limits')).getPlanLimitsFn(),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
  return enabled && planFeatureNoticeApplies(feature, data)
}
