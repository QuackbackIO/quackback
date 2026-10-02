import { lazy, Suspense, useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { TryMessengerStart } from './try-messenger-sheet'

// The sheet carries the inbox thread and a QR encoder; entry points load it on first open.
const TryMessengerSheet = lazy(() =>
  import('./try-messenger-sheet').then((m) => ({ default: m.TryMessengerSheet }))
)

export function TryMessengerButton({
  start = 'message',
  children,
  ...buttonProps
}: {
  start?: TryMessengerStart
  children: ReactNode
} & Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  const canTry = usePermission(PERMISSIONS.CONVERSATION_VIEW)
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  if (!canTry) return null
  return (
    <>
      <Button
        {...buttonProps}
        onClick={() => {
          setLoaded(true)
          setOpen(true)
        }}
      >
        {children}
      </Button>
      {loaded && (
        <Suspense fallback={null}>
          <TryMessengerSheet open={open} onOpenChange={setOpen} start={start} />
        </Suspense>
      )}
    </>
  )
}
