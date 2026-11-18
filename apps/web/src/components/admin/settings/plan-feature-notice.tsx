/**
 * One quiet line at the top of a paid feature's settings page while that
 * feature is paused after the plan limits grace, or will pause when the grace
 * ends. Nothing shows otherwise.
 *
 * With the plan limits flag off this renders nothing and costs nothing: no
 * query, no request and no chunk. The flag rides on the settings every page
 * already has, and the notice's query, copy and markup load only when it is on.
 */
import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import type { PlanNoticeFeature } from './plan-feature-notice-body'
import {
  PLAN_FEATURE_NOTICE_QUERY_KEY,
  planFeatureNoticeApplies,
} from './plan-feature-notice-state'

const PlanFeatureNoticeBody = lazy(() => import('./plan-feature-notice-body'))

export function PlanFeatureNotice({ feature }: { feature: PlanNoticeFeature }) {
  const enabled = useWorkspaceSettings()?.featureFlags?.planLimits === true
  if (!enabled) return null
  return (
    <Suspense fallback={null}>
      <PlanFeatureNoticeBody feature={feature} />
    </Suspense>
  )
}

/**
 * Whether the page carries the paused notice for `feature`, so an upgrade box
 * of its own would say the same thing twice. Shares the notice's query; with
 * the flag off it runs nothing and answers false.
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
