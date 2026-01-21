import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { KeyIcon } from '@heroicons/react/24/solid'
import type { PublicOIDCConfig } from '@/lib/settings'
import { GitHubIcon, GoogleIcon } from '@/components/icons/social-icons'
import { openAuthPopup, useAuthBroadcast, usePopupTracker } from '@/lib/hooks/use-auth-broadcast'

interface OAuthButtonsProps {
  orgSlug: string
  callbackUrl?: string
  /** Whether to show GitHub sign-in button (default: true) */
  showGitHub?: boolean
  /** Whether to show Google sign-in button (default: true) */
  showGoogle?: boolean
  /** OIDC provider config (optional) */
  oidcConfig?: PublicOIDCConfig | null
  /** OIDC type: 'portal' for portal users, 'team' for team members (default: 'portal') */
  oidcType?: 'portal' | 'team'
  /** Callback when auth succeeds (for popup flow) */
  onSuccess?: () => void
}

/**
 * OAuth Buttons Component
 *
 * Renders GitHub, Google, and custom OIDC sign-in buttons.
 * All providers use popup windows for authentication.
 * All providers use the custom /api/auth/oauth/[provider] route which:
 * - Handles OAuth initiation with signed state containing workspace info
 * - Redirects callback to app domain, then transfers session to tenant domain
 */
export function OAuthButtons({
  orgSlug,
  callbackUrl = '/',
  showGitHub = true,
  showGoogle = true,
  oidcConfig,
  oidcType = 'portal',
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

  function handleOAuthLogin(provider: 'github' | 'google' | 'oidc'): void {
    if (hasPopup()) {
      focusPopup()
      return
    }

    setLoadingProvider(provider)
    setPopupBlocked(false)

    // Build OAuth initiation URL with workspace info
    // All providers use the same custom route which handles:
    // - OAuth initiation with signed state
    // - Callback on app domain
    // - Session transfer to tenant domain
    const params = new URLSearchParams({
      workspace: orgSlug,
      returnDomain: window.location.host,
      callbackUrl: '/auth/auth-complete',
      popup: 'true',
      ...(provider === 'oidc' ? { type: oidcType } : {}),
    })
    const oauthUrl = `/api/auth/oauth/${provider}?${params}`

    const popup = openAuthPopup(oauthUrl)
    if (!popup) {
      setPopupBlocked(true)
      setLoadingProvider(null)
      return
    }
    trackPopup(popup)
  }

  const showOIDC = oidcConfig?.enabled === true

  // Don't render anything if all providers are disabled
  if (!showGitHub && !showGoogle && !showOIDC) {
    return null
  }

  return (
    <div className="space-y-3">
      {popupBlocked && (
        <p className="text-sm text-destructive text-center">
          Popup blocked. Please allow popups for this site.
        </p>
      )}
      {showOIDC && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleOAuthLogin('oidc')}
          disabled={loadingProvider !== null}
        >
          <KeyIcon className="mr-2 h-4 w-4" />
          {loadingProvider === 'oidc'
            ? 'Signing in...'
            : `Continue with ${oidcConfig?.displayName || 'SSO'}`}
        </Button>
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
