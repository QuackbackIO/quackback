import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { postAuthSuccess, postAuthError } from '@/lib/client/hooks/use-auth-broadcast'
import { AUTH_BLOCK_MESSAGES } from '@/lib/shared/auth-block-messages'
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'

/**
 * Auth Complete Page
 *
 * Popup landing for OAuth sign-ins. On success it broadcasts to the
 * original window via BroadcastChannel and closes itself.
 *
 * It is also the popup's `errorCallbackURL`: a failed OAuth callback
 * lands here with `?error=<code>`. That error is broadcast to the
 * opener (whose dialog is still mounted and can react — e.g. offer the
 * link-conflict recovery for `account_not_linked`) and shown here so
 * the failure is never a silent "Signed in successfully!" + close.
 */
export const Route = createFileRoute('/auth/auth-complete')({
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: AuthCompletePage,
})

function AuthCompletePage() {
  const { error } = Route.useSearch()
  const [status, setStatus] = useState<'broadcasting' | 'success' | 'error'>('broadcasting')

  useEffect(() => {
    if (error) {
      postAuthError(error)
      setStatus('error')
      // account_not_linked recovery continues in the opener's dialog —
      // get this window out of the way quickly. Other errors keep the
      // window up long enough to read the message.
      const timeout = setTimeout(
        () => {
          window.close()
        },
        error === 'account_not_linked' ? 1500 : 6000
      )
      return () => clearTimeout(timeout)
    }

    // Post success message to other windows
    postAuthSuccess()
    setStatus('success')

    // Close the window after a brief delay
    const timeout = setTimeout(() => {
      window.close()
    }, 1000)

    return () => clearTimeout(timeout)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8 max-w-md">
        {status === 'broadcasting' && (
          <>
            <ArrowPathIcon className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Completing sign in...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto" />
            <p className="text-foreground font-medium">Signed in successfully!</p>
            <p className="text-sm text-muted-foreground">This window will close automatically.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <ExclamationTriangleIcon className="h-12 w-12 text-amber-500 mx-auto" />
            <p className="text-foreground font-medium">Sign-in didn&apos;t complete</p>
            <p className="text-sm text-muted-foreground">
              {AUTH_BLOCK_MESSAGES[error as keyof typeof AUTH_BLOCK_MESSAGES] ??
                'Sign-in failed. Return to the original window and try again.'}
            </p>
            <p className="text-sm text-muted-foreground">This window will close automatically.</p>
          </>
        )}
      </div>
    </div>
  )
}
