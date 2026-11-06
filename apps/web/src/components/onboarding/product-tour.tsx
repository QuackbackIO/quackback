import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { OnboardingOutcome } from '@/lib/shared/db-types'

/** What the end card's next action knows about the workspace. */
export interface TourEndActionContext {
  goals: readonly OnboardingOutcome[]
  feedbackPrivate: boolean
  /** Close the end card, for an action that opens something of its own. */
  close: () => void
}

/** Renders the end card's primary next step; the card shows only Done without one. */
export type TourEndAction = (context: TourEndActionContext) => ReactNode

const TourApi = createContext<{ start: () => void } | null>(null)

export function useProductTour() {
  return useContext(TourApi)
}

// The provider wraps every admin page, while the tour runs only on request,
// so the stops, coachmark and end card load the first time it starts.
const ProductTourRunner = lazy(() =>
  import('./product-tour-runner').then((m) => ({ default: m.ProductTourRunner }))
)

export function ProductTourProvider({
  children,
  endAction,
}: {
  children: ReactNode
  endAction?: TourEndAction
}) {
  // Counts start requests; each new value starts the tour from the top.
  const [runId, setRunId] = useState(0)
  const start = useCallback(() => setRunId((n) => n + 1), [])
  const api = useMemo(() => ({ start }), [start])
  return (
    <TourApi.Provider value={api}>
      {children}
      {runId > 0 && (
        <Suspense fallback={null}>
          <ProductTourRunner runId={runId} endAction={endAction} />
        </Suspense>
      )}
    </TourApi.Provider>
  )
}
