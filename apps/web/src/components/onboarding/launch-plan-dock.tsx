import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'

// The sidebar is on every admin page; the popover loads only while a plan is open.
const LaunchPlanPopover = lazy(() =>
  import('./launch-plan-popover').then((m) => ({ default: m.LaunchPlanPopover }))
)

export function LaunchPlanDock() {
  const canView = usePermission(PERMISSIONS.MEMBER_VIEW)
  // Reads what Home loaded; fetching here would cost every admin page a request.
  const { data } = useQuery({ ...adminQueries.onboardingStatus(), enabled: false })
  if (!canView || !data) return null
  return (
    <Suspense fallback={null}>
      <LaunchPlanPopover status={data} />
    </Suspense>
  )
}
