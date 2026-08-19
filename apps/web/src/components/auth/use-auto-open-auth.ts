import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { AUTH_BLOCK_MESSAGES } from '@/lib/server/auth/redirect-errors'
import { navigateAfterAuth } from '@/lib/client/post-auth-navigation'
import { takeSsoAttempt } from '@/lib/client/sso-attempt-stash'

/** Opens the auth dialog once when the portal root is reached with a `?auth`
 *  request, navigating to `callbackUrl` on success. No-op when already
 *  authenticated. The dialog opens at most once per mount (latched). Error
 *  toasts fire at most once per mount (separate latch).
 *
 *  `?error=account_not_linked` (an SSO callback found an existing local
 *  account that isn't verified) gets recovery instead of a toast: the
 *  dialog opens straight into the link-conflict view, seeded with the
 *  attempt context stashed before the redirect to the IdP. */
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
    const isLinkConflict = args.error === 'account_not_linked'

    // Toast at most once per mount regardless of dep changes. The
    // link-conflict case is handled by the dialog below, not a toast.
    if (!errorToasted.current && args.error && !isLinkConflict) {
      errorToasted.current = true
      toast.error(
        AUTH_BLOCK_MESSAGES[args.error as keyof typeof AUTH_BLOCK_MESSAGES] ??
          'Sign-in failed. Try again or contact your administrator if the problem persists.'
      )
    }

    // Open the dialog when explicitly requested via ?auth, or to run
    // link-conflict recovery (which needs the dialog even if the error
    // redirect lost the ?auth param).
    // Delay the latch check until after the error path so they don't block each other.
    if (opened.current) return
    const shouldOpen = !!args.mode || isLinkConflict
    if (!shouldOpen || args.isAuthenticated || !popover) return
    opened.current = true
    const attempt = isLinkConflict ? takeSsoAttempt() : null
    popover.openAuthPopover({
      mode: args.mode ?? 'login',
      callbackUrl: args.callbackUrl ?? attempt?.callbackUrl,
      linkConflict: isLinkConflict
        ? {
            providerId: attempt?.providerId,
            providerType: attempt?.providerType,
            email: attempt?.email,
          }
        : undefined,
      onSuccess: args.callbackUrl
        ? () =>
            navigateAfterAuth(args.callbackUrl!, () => router.navigate({ to: args.callbackUrl! }))
        : undefined,
    })
  }, [args.mode, args.callbackUrl, args.error, args.isAuthenticated, popover, router])
}
