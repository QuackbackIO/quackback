import { useState } from 'react'
import { FormattedMessage } from 'react-intl'
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
          <FormattedMessage
            id="portal.auth.oauth.popupBlockedShort"
            defaultMessage="Popup blocked. Please allow popups for this site."
          />
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
            {loadingProvider === provider.id ? (
              <FormattedMessage id="portal.auth.oauth.signingIn" defaultMessage="Signing in..." />
            ) : (
              <FormattedMessage
                id="portal.auth.oauth.continueWith"
                defaultMessage="Continue with {provider}"
                values={{ provider: provider.name }}
              />
            )}
          </Button>
        )
      })}
    </div>
  )
}

/**
 * True when the portal exposes at least one user-facing sign-in method
 * (password, magic link, any enabled OAuth provider, or any registered OIDC
 * identity provider — including a routed-only one that has no public button).
 * Pass `registeredAuthProviders` from the auth-runtime view
 * (`getRegisteredAuthProviders`), not raw config flags, so a stale toggle with
 * no platform credential doesn't keep the entry point visible.
 */
export function hasAnyPortalAuthMethod(
  authConfig: Record<string, boolean | undefined>,
  opts?: {
    /** All registered auth provider ids (OIDC registrationIds + social ids),
     *  from `getRegisteredAuthProviders`. */
    registeredAuthProviders?: string[]
    /** Public-button OIDC providers from the identity_provider list. */
    oidcProviders?: OidcProviderEntry[]
  }
): boolean {
  if (authConfig.password || authConfig.magicLink) return true
  if (getEnabledOAuthProviders(authConfig, opts?.oidcProviders).length > 0) return true
  // A routed-only OIDC provider (verified domain, no public button) renders no
  // button but is a real sign-in path — reached by entering a domain email — so
  // it still needs the "Log in" entry point.
  if (hasRoutableOidcProvider(opts?.registeredAuthProviders, opts?.oidcProviders)) return true
  return false
}

/**
 * Does the workspace have a *routed-only* OIDC provider — one registered for
 * auth (legacy `sso` / `custom-oidc` or a net-new `oidc_*`) but with no public
 * button (verified domain, "show a button" off)? Such a provider is reachable
 * only by entering a domain email (the Stage-2 lookup routes it), so both the
 * portal "Log in" entry point and the email input must appear even when
 * password / magic-link are off.
 *
 * Identified as a registered id that is neither a social provider nor one of
 * the public buttons: public-button providers (incl. routed ones the admin
 * opted back in) come through `publicOidcProviders` / the social `authConfig`
 * toggles, so they already render a button and don't need email routing.
 */
export function hasRoutableOidcProvider(
  registeredAuthProviders?: string[],
  publicOidcProviders?: OidcProviderEntry[]
): boolean {
  if (!registeredAuthProviders?.length) return false
  const socialIds = new Set(
    AUTH_PROVIDERS.filter((p) => p.type !== 'generic-oauth').map((p) => p.id)
  )
  const publicOidcIds = new Set((publicOidcProviders ?? []).map((p) => p.id))
  return registeredAuthProviders.some((id) => !socialIds.has(id) && !publicOidcIds.has(id))
}

/**
 * When the workspace's ONLY usable portal sign-in method is a single OIDC
 * identity provider — exactly one registered IdP, no registered social
 * provider, and no password / magic link — every sign-in necessarily flows
 * through that one provider. The portal can then skip the email-entry dialog
 * and redirect straight to it on "Log in" / "Sign up". Returns the sole
 * provider's registrationId, or null when the dialog is still needed (more than
 * one method, or a choice of providers).
 */
export function resolveSoleOidcProvider(
  registeredAuthProviders: string[] | undefined,
  portalOauth: Record<string, boolean | undefined>
): string | null {
  if (!registeredAuthProviders?.length) return null
  const socialIds = new Set(
    AUTH_PROVIDERS.filter((p) => p.type !== 'generic-oauth').map((p) => p.id)
  )
  const oidcIds = registeredAuthProviders.filter((id) => !socialIds.has(id))
  // Exactly one registered provider, and it's the OIDC one (no social alongside).
  if (registeredAuthProviders.length !== 1 || oidcIds.length !== 1) return null
  // A built-in email method (password default on; magic-link default off) means
  // the user still has a choice, so keep the dialog.
  if ((portalOauth.password ?? true) || (portalOauth.magicLink ?? false)) return null
  return oidcIds[0]
}

/** A public OIDC button from the identity_provider list: `id` is the
 *  provider's registrationId, `name` its display label. */
export type OidcProviderEntry = { id: string; name: string }

/**
 * Build the portal sign-in button list. Social providers (google/github/…)
 * come from the static AUTH_PROVIDERS map keyed by the `authConfig` record;
 * OIDC providers come from `oidcProviders` (the identity_provider table).
 * Generic-oauth entries in the static map are skipped — OIDC buttons have
 * a single source now, so the static path never double-emits one.
 */
export function getEnabledOAuthProviders(
  authConfig: Record<string, boolean | undefined>,
  oidcProviders?: OidcProviderEntry[]
): OAuthProviderEntry[] {
  const providerMap = new Map(AUTH_PROVIDERS.map((p) => [p.id, p]))
  const result: OAuthProviderEntry[] = []

  for (const [key, enabled] of Object.entries(authConfig)) {
    if (key === 'email' || key === 'password' || !enabled) continue
    const provider = providerMap.get(key)
    // OIDC/generic-oauth buttons are sourced from `oidcProviders`; skip
    // them here so the static map can't render a duplicate or stale one.
    if (!provider || provider.type === 'generic-oauth') continue
    result.push({ id: provider.id, name: provider.name, type: 'social' })
  }

  for (const p of oidcProviders ?? []) {
    result.push({ id: p.id, name: p.name, type: 'generic-oauth' })
  }

  return result
}
