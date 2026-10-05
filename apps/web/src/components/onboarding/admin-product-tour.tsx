import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useCopilotOnHome } from '@/components/admin/ask/copilot-on-home'
import { ProductTourProvider, type TourEndAction } from './product-tour'
import type { TryMessengerStart } from './try-messenger-sheet'
import { SheetMessages } from './sheet-messages'

// The admin layout owns the one Try Messenger sheet and is the only module
// that loads it. The sheet embeds the inbox thread; loaded from the pages'
// shared chunks instead, the thread's helpers would split into chunks of their
// own that every admin page requests.
const TryMessengerSheet = lazy(() =>
  import('./try-messenger-sheet').then((m) => ({ default: m.TryMessengerSheet }))
)
// The tour's end card action loads as the card opens.
const TourEndTestAction = lazy(() =>
  import('./test-actions').then((m) => ({ default: m.TourEndTestAction }))
)

/**
 * `OPEN_TRY_MESSENGER_EVENT` in `try-messenger-button`, spelled out so this
 * module does not import that one (a test keeps the two equal).
 */
export const OPEN_TRY_MESSENGER_EVENT = 'quackback:open-try-messenger'

/** The admin's guided tour, ending on the next test action, and the one Try Messenger sheet. */
export function AdminProductTourProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<{ open: boolean; start: TryMessengerStart } | null>(null)
  // Home is the Copilot chat for this teammate, so the tour opens on it.
  const copilotOnHome = useCopilotOnHome()
  const open = useCallback((start: TryMessengerStart = 'message') => {
    setSheet({ open: true, start })
  }, [])
  useEffect(() => {
    const onOpen = (event: Event) => {
      const start = (event as CustomEvent<unknown>).detail
      open(start === 'idea' ? 'idea' : 'message')
    }
    window.addEventListener(OPEN_TRY_MESSENGER_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_TRY_MESSENGER_EVENT, onOpen)
  }, [open])
  const onOpenChange = useCallback(
    (next: boolean) => setSheet((prev) => prev && { ...prev, open: next }),
    []
  )
  const endAction = useCallback<TourEndAction>(
    ({ feedbackPrivate, close }) => (
      <Suspense fallback={null}>
        <TourEndTestAction
          feedbackPrivate={feedbackPrivate}
          onOpen={(start) => {
            close()
            open(start)
          }}
        />
      </Suspense>
    ),
    [open]
  )
  return (
    <ProductTourProvider endAction={endAction} copilotOnHome={copilotOnHome} openTest={open}>
      {children}
      {sheet && (
        <Suspense fallback={null}>
          <SheetMessages>
            <TryMessengerSheet open={sheet.open} onOpenChange={onOpenChange} start={sheet.start} />
          </SheetMessages>
        </Suspense>
      )}
    </ProductTourProvider>
  )
}
