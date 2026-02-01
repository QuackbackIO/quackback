import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { postAuthSuccess } from '@/lib/client/hooks/use-auth-broadcast'
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/solid'

/**
 * Auth Complete Page
 *
 * This page is shown after authentication completes in a popup window.
 * It broadcasts the success message to the original window via BroadcastChannel,
 * then closes itself.
 */
export const Route = createFileRoute('/auth/auth-complete')({
  component: AuthCompletePage,
})

function AuthCompletePage() {
  const [status, setStatus] = useState<'broadcasting' | 'success'>('broadcasting')

  useEffect(() => {
    // Post success message to other windows
    postAuthSuccess()
    setStatus('success')

    // Close the window after a brief delay
    const timeout = setTimeout(() => {
      window.close()
    }, 1000)

    return () => clearTimeout(timeout)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8">
        {status === 'broadcasting' ? (
          <>
            <ArrowPathIcon className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Completing sign in...</p>
          </>
        ) : (
          <>
            <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto" />
            <p className="text-foreground font-medium">Signed in successfully!</p>
            <p className="text-sm text-muted-foreground">This window will close automatically.</p>
          </>
        )}
      </div>
    </div>
  )
}
