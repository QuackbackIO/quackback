import { useCallback, type ComponentProps, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { adminQueries } from '@/lib/client/queries/admin'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { TryMessengerStart } from './try-messenger-sheet'

/**
 * The event that opens the admin's one Try Messenger sheet. The admin layout
 * hosts the sheet (`AdminProductTourProvider`) and is the only module that
 * loads it: the sheet embeds the inbox thread, and loading it from these
 * shared entry points would split the thread's helpers into chunks of their
 * own that every admin page requests. An event, rather than a context, keeps
 * this module out of the layout's imports for the same reason.
 */
export const OPEN_TRY_MESSENGER_EVENT = 'quackback:open-try-messenger'

/** Opens the admin's Try Messenger sheet on the given test. */
export function useOpenTryMessenger(): (start?: TryMessengerStart) => void {
  return useCallback((start: TryMessengerStart = 'message') => {
    window.dispatchEvent(new CustomEvent(OPEN_TRY_MESSENGER_EVENT, { detail: start }))
  }, [])
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
  const open = useOpenTryMessenger()
  if (!canTry || (start === 'idea' && !canPostIdea)) return null
  return (
    <Button {...buttonProps} onClick={() => open(start)}>
      {children}
    </Button>
  )
}
