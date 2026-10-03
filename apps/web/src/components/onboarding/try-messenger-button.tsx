import { lazy, Suspense, useCallback, useState, type ComponentProps, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { adminQueries } from '@/lib/client/queries/admin'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { TryMessengerStart } from './try-messenger-sheet'

// The sheet carries the inbox thread and a QR encoder; entry points load it on first open.
const TryMessengerSheet = lazy(() =>
  import('./try-messenger-sheet').then((m) => ({ default: m.TryMessengerSheet }))
)

/**
 * Open the "Try Messenger" sheet from anywhere: `open('message' | 'idea')`
 * shows it, and the caller renders `sheet` once. The sheet's code loads on the
 * first open.
 */
export function useTryMessengerSheet(): {
  open: (start?: TryMessengerStart) => void
  sheet: ReactNode
} {
  const [state, setState] = useState<{ open: boolean; start: TryMessengerStart } | null>(null)
  const open = useCallback((start: TryMessengerStart = 'message') => {
    setState({ open: true, start })
  }, [])
  const sheet = state ? (
    <Suspense fallback={null}>
      <TryMessengerSheet
        open={state.open}
        onOpenChange={(next) => setState((prev) => prev && { ...prev, open: next })}
        start={state.start}
      />
    </Suspense>
  ) : null
  return { open, sheet }
}

/** Whether the caller's test customer could post an idea anywhere right now. */
export function useCanPostTestIdea(enabled = true): boolean {
  const { data } = useQuery({ ...adminQueries.onboardingStatus(), enabled })
  return data?.canPostTestIdea === true
}

export function TryMessengerButton({
  start = 'message',
  children,
  ...buttonProps
}: {
  start?: TryMessengerStart
  children: ReactNode
} & Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  const canTry = usePermission(PERMISSIONS.CONVERSATION_VIEW)
  const canPostIdea = useCanPostTestIdea(canTry && start === 'idea')
  const { open, sheet } = useTryMessengerSheet()
  if (!canTry || (start === 'idea' && !canPostIdea)) return null
  return (
    <>
      <Button {...buttonProps} onClick={() => open(start)}>
        {children}
      </Button>
      {sheet}
    </>
  )
}
