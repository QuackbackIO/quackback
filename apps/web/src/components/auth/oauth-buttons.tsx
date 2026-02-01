import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { GitHubIcon, GoogleIcon } from '@/components/icons/social-icons'
import {
  openAuthPopup,
  useAuthBroadcast,
  usePopupTracker,
} from '@/lib/client/hooks/use-auth-broadcast'

interface OAuthButtonsProps {
  callbackUrl?: string
  /** Whether to show GitHub sign-in button (default: true) */
  showGitHub?: boolean
  /** Whether to show Google sign-in button (default: true) */
  showGoogle?: boolean
  /** Callback when auth succeeds (for popup flow) */
  onSuccess?: () => void
}

/**
 * OAuth Buttons Component
 *
 * Renders GitHub and Google sign-in buttons.
 * All providers use popup windows for authentication.
 */
export function OAuthButtons({
  callbackUrl = '/',
  showGitHub = true,
  showGoogle = true,
  onSuccess,
}: OAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const { trackPopup, hasPopup, focusPopup, clearPopup } = usePopupTracker({
    onPopupClosed: () => {
      setLoadingProvider(null)
    },
  })

  useAuthBroadcast({
    onSuccess: () => {
      clearPopup()
      setLoadingProvider(null)
      if (onSuccess) {
        onSuccess()
      } else {
        window.location.href = callbackUrl
      }
    },
  })

  function handleOAuthLogin(provider: 'github' | 'google'): void {
    if (hasPopup()) {
      focusPopup()
      return
    }

    setLoadingProvider(provider)
    setPopupBlocked(false)

    // Build OAuth URL using Better Auth's socialProviders
    const params = new URLSearchParams({
      callbackURL: callbackUrl,
    })
    const oauthUrl = `/api/auth/sign-in/${provider}?${params}`

    const popup = openAuthPopup(oauthUrl)
    if (!popup) {
      setPopupBlocked(true)
      setLoadingProvider(null)
      return
    }
    trackPopup(popup)
  }

  // Don't render anything if all providers are disabled
  if (!showGitHub && !showGoogle) {
    return null
  }

  return (
    <div className="space-y-3">
      {popupBlocked && (
        <p className="text-sm text-destructive text-center">
          Popup blocked. Please allow popups for this site.
        </p>
      )}
      {showGitHub && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleOAuthLogin('github')}
          disabled={loadingProvider !== null}
        >
          <GitHubIcon className="mr-2 h-4 w-4" />
          {loadingProvider === 'github' ? 'Signing in...' : 'Continue with GitHub'}
        </Button>
      )}
      {showGoogle && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleOAuthLogin('google')}
          disabled={loadingProvider !== null}
        >
          <GoogleIcon className="mr-2 h-4 w-4" />
          {loadingProvider === 'google' ? 'Signing in...' : 'Continue with Google'}
        </Button>
      )}
    </div>
  )
}
