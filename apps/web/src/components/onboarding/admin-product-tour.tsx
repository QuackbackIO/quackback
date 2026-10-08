import { lazy, Suspense, useCallback, type ReactNode } from 'react'
import { useCopilotOnHome } from '@/components/admin/ask/copilot-on-home'
import { useGoingLiveSheets } from './going-live-sheets'
import { ProductTourProvider, type TourEndAction } from './product-tour'

// The tour's end card action loads as the card opens.
const TourEndGoalAction = lazy(() =>
  import('./goal-actions').then((m) => ({ default: m.TourEndGoalAction }))
)

/** The admin's guided tour, ending on the first goal's real action, and the going-live sheet. */
export function AdminProductTourProvider({ children }: { children: ReactNode }) {
  // Home is the Copilot chat for this teammate, so the tour opens on it.
  const copilotOnHome = useCopilotOnHome()
  const goingLiveSheet = useGoingLiveSheets()
  const endAction = useCallback<TourEndAction>(
    ({ goals, close }) => (
      <Suspense fallback={null}>
        <TourEndGoalAction goals={goals} onLeave={close} />
      </Suspense>
    ),
    []
  )
  return (
    <ProductTourProvider endAction={endAction} copilotOnHome={copilotOnHome}>
      {children}
      {goingLiveSheet}
    </ProductTourProvider>
  )
}
