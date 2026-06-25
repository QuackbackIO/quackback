import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { AUTH_BLOCK_MESSAGES } from '@/lib/server/auth/redirect-errors'
import { navigateAfterAuth } from '@/lib/client/post-auth-navigation'

/** Opens the auth dialog once when the portal root is reached with a `?auth`
 *  request, navigating to `callbackUrl` on success. No-op when already
 *  authenticated. The dialog opens at most once per mount (latched). Error
 *  toasts fire at most once per mount (separate latch). */
export function useAutoOpenAuthDialog(args: {
  mode?: 'login' | 'signup'
  callbackUrl?: string
  error?: string
  isAuthenticated: boolean
}): void {
  const popover = useAuthPopoverSafe()
  const router = useRouter()
  // Separate refs so an error toast doesn't suppress the open path and
  // vice versa — they are independent one-shot side effects.
  const opened = useRef(false)
  const errorToasted = useRef(false)

  useEffect(() => {
    // Toast at most once per mount regardless of dep changes.
    if (!errorToasted.current && args.error) {
      errorToasted.current = true
      toast.error(
        AUTH_BLOCK_MESSAGES[args.error as keyof typeof AUTH_BLOCK_MESSAGES] ??
          'Sign-in failed. Try again or contact your administrator if the problem persists.'
      )
    }

    // Open the dialog when explicitly requested via ?auth.
    // Delay the latch check until after the error path so they don't block each other.
    if (opened.current) return
    const shouldOpen = !!args.mode
    if (!shouldOpen || args.isAuthenticated || !popover) return
    opened.current = true
    popover.openAuthPopover({
      mode: args.mode!,
      callbackUrl: args.callbackUrl,
      onSuccess: args.callbackUrl
        ? () =>
            navigateAfterAuth(args.callbackUrl!, () => router.navigate({ to: args.callbackUrl! }))
        : undefined,
    })
  }, [args.mode, args.callbackUrl, args.error, args.isAuthenticated, popover, router])
}
