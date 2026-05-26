import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AUTH_PROVIDER_ICON_MAP } from '@/components/icons/social-provider-icons'
import { AUTH_PROVIDERS } from '@/lib/shared/auth-providers'
import {
  openAuthPopup,
  useAuthBroadcast,
  usePopupTracker,
} from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/client/auth-client'

export type OAuthProviderEntry = {
  id: string
  name: string
  type: 'social' | 'generic-oauth'
}

/**
 * The URL Better-Auth's OAuth callback redirects the popup to AFTER the
 * authorization-code → session exchange succeeds. We always send the
 * popup to `/auth/auth-complete`, which fires `postAuthSuccess()` over
 * BroadcastChannel and closes the window. The opener's
 * `useAuthBroadcast` listener picks up the message and navigates the
 * MAIN tab to whatever post-login URL the caller actually wanted
 * (e.g. `/` for the portal, the original deep link otherwise).
 *
 * Without this override the popup would land directly on the caller's
 * `callbackUrl` (typically `/`), never broadcasting and never closing —
 * the main tab stays on the login form with no signal that auth
 * finished, and the user has to manually close the popup and reload.
 */
const POPUP_BROADCAST_URL = '/auth/auth-complete'

/**
 * Get the OAuth redirect URL for a provider.
 * Handles routing between signIn.oauth2 (generic) and signIn.social (built-in).
 *
 * `callbackURL` here is the value Better-Auth uses post-callback — we
 * hard-code it to `POPUP_BROADCAST_URL` so the popup always reaches the
 * close-and-broadcast page. The caller-supplied destination is honored
 * separately by the opener via `useAuthBroadcast` (see below).
 */
export async function getOAuthRedirectUrl(
  provider: OAuthProviderEntry,
  // Accepted for API compatibility but intentionally unused — see the
  // POPUP_BROADCAST_URL comment above.
  _callbackURL: string
): Promise<string | null> {
  const result =
    provider.type === 'generic-oauth'
      ? await authClient.signIn.oauth2({
          providerId: provider.id,
          callbackURL: POPUP_BROADCAST_URL,
          disableRedirect: true,
        })
      : await authClient.signIn.social({
          provider: provider.id,
          callbackURL: POPUP_BROADCAST_URL,
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
 *
 * `sso` is treated specially: it's not an entry in `AUTH_PROVIDERS`
 * because its credentials/discoveryUrl live in `authConfig.ssoOidc`
 * (a single dedicated config) rather than in `platform_credentials`
 * keyed by `auth_<id>`. The server-side config builders inject
 * `authConfig.sso = true` into the public configs whenever the
 * workspace's SSO IdP is enabled, and we surface a synthetic
 * `OAuthProviderEntry` for it here so it renders alongside the
 * social providers (Google, GitHub, …). The display name comes
 * from `customProviderNames.sso` (settable in the SSO admin page)
 * and falls back to a sensible generic label.
 */
export function getEnabledOAuthProviders(
  authConfig: Record<string, boolean | undefined>,
  customProviderNames?: Record<string, string>
): OAuthProviderEntry[] {
  const providerMap = new Map(AUTH_PROVIDERS.map((p) => [p.id, p]))
  const result: OAuthProviderEntry[] = []

  // Surface SSO first so it sits at the top of the button stack —
  // for tenants who set it up, SSO is almost always the primary path.
  if (authConfig.sso === true) {
    result.push({
      id: 'sso',
      name: customProviderNames?.sso || 'Single sign-on',
      type: 'generic-oauth',
    })
  }

  for (const [key, enabled] of Object.entries(authConfig)) {
    if (key === 'email' || key === 'password' || key === 'sso' || !enabled) continue
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
