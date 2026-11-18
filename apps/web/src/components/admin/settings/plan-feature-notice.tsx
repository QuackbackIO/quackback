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
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import type { PlanNoticeFeature } from './plan-feature-notice-body'

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
