import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { AUTH_BLOCK_MESSAGES } from '@/lib/server/auth/redirect-errors'

/** Opens the auth dialog once when the portal root is reached with a `?signin`
 *  request, navigating to `callbackUrl` on success. No-op when already
 *  authenticated. Runs at most once per mount (latched). */
export function useAutoOpenAuthDialog(args: {
  signin?: 'login' | 'signup'
  callbackUrl?: string
  error?: string
  isAuthenticated: boolean
}): void {
  const popover = useAuthPopoverSafe()
  const router = useRouter()
  const opened = useRef(false)

  useEffect(() => {
    if (opened.current) return
    if (args.error) {
      toast.error(AUTH_BLOCK_MESSAGES[args.error as keyof typeof AUTH_BLOCK_MESSAGES] ?? args.error)
    }
    if (!args.signin || args.isAuthenticated || !popover) return
    opened.current = true
    popover.openAuthPopover({
      mode: args.signin,
      callbackUrl: args.callbackUrl,
      onSuccess: args.callbackUrl ? () => router.navigate({ to: args.callbackUrl! }) : undefined,
    })
  }, [args.signin, args.callbackUrl, args.error, args.isAuthenticated, popover, router])
}
