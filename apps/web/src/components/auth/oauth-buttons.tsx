import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AUTH_PROVIDER_ICON_MAP } from '@/components/icons/social-provider-icons'
import { AUTH_PROVIDERS } from '@/lib/server/auth/auth-providers'
import {
  openAuthPopup,
  useAuthBroadcast,
  usePopupTracker,
} from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/server/auth/client'

export type OAuthProviderEntry = {
  id: string
  name: string
  type: 'social' | 'generic-oauth'
}

/**
 * Get the OAuth redirect URL for a provider.
 * Handles routing between signIn.oauth2 (generic) and signIn.social (built-in).
 */
export async function getOAuthRedirectUrl(
  provider: OAuthProviderEntry,
  callbackURL: string
): Promise<string | null> {
  const result =
    provider.type === 'generic-oauth'
      ? await authClient.signIn.oauth2({
          providerId: provider.id,
          callbackURL,
          disableRedirect: true,
        })
      : await authClient.signIn.social({
          provider: provider.id,
          callbackURL,
          disableRedirect: true,
        })
  return result.data?.url ?? null
}

interface OAuthButtonsProps {
  callbackUrl?: string
  /** Dynamic list of enabled providers keyed by provider ID */
  providers: OAuthProviderEntry[]
  /** Callback when auth succeeds (for popup flow) */
  onSuccess?: () => void
}

/**
 * OAuth Buttons Component
 *
 * Renders sign-in buttons for any configured OAuth provider.
 * All providers use popup windows for authentication.
 */
export function OAuthButtons({ callbackUrl = '/', providers, onSuccess }: OAuthButtonsProps) {
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

  async function handleOAuthLogin(provider: OAuthProviderEntry): Promise<void> {
    if (hasPopup()) {
      focusPopup()
      return
    }

    setLoadingProvider(provider.id)
    setPopupBlocked(false)

    // Open popup synchronously (must be in direct response to user click)
    const popup = openAuthPopup('about:blank')
    if (!popup) {
      setPopupBlocked(true)
      setLoadingProvider(null)
      return
    }
    trackPopup(popup)

    try {
      const url = await getOAuthRedirectUrl(provider, callbackUrl)
      if (url) {
        popup.location.href = url
      } else {
        popup.close()
        setLoadingProvider(null)
      }
    } catch {
      popup.close()
      setLoadingProvider(null)
    }
  }

  // Don't render anything if no providers
  if (providers.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {popupBlocked && (
        <p className="text-sm text-destructive text-center">
          Popup blocked. Please allow popups for this site.
        </p>
      )}
      {providers.map((provider) => {
        const IconComponent = AUTH_PROVIDER_ICON_MAP[provider.id]
        return (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => handleOAuthLogin(provider)}
            disabled={loadingProvider !== null}
          >
            {IconComponent && <IconComponent className="mr-2 h-4 w-4" />}
            {loadingProvider === provider.id ? 'Signing in...' : `Continue with ${provider.name}`}
          </Button>
        )
      })}
    </div>
  )
}

/**
 * Build provider list from PortalAuthMethods config.
 * Filters to only enabled OAuth providers (excludes 'email').
 */
export function getEnabledOAuthProviders(
  authConfig: Record<string, boolean | undefined>,
  customProviderNames?: Record<string, string>
): OAuthProviderEntry[] {
  const providerMap = new Map(AUTH_PROVIDERS.map((p) => [p.id, p]))
  const result: OAuthProviderEntry[] = []

  for (const [key, enabled] of Object.entries(authConfig)) {
    if (key === 'email' || key === 'password' || !enabled) continue
    const provider = providerMap.get(key)
    if (provider) {
      result.push({
        id: provider.id,
        name: customProviderNames?.[provider.id] || provider.name,
        type: provider.type === 'generic-oauth' ? 'generic-oauth' : 'social',
      })
    }
  }

  return result
}
