/**
 * Which callback URL an OIDC provider sends as its `redirect_uri`.
 *
 * Two paths reach the same handler: `/api/auth/oauth2/callback/<id>` and
 * `/api/auth/callback/<id>`. The auth catch-all rewrites the first onto the
 * second, so a return to either completes. What differs is the URL sent on
 * the authorize request and the token exchange, and many IdPs match that
 * exactly against the redirect URIs registered with them.
 *
 * - `legacy` sends `/api/auth/oauth2/callback/<id>`. Providers that existed
 *   before the sign-in library moved its callback registered this URL, and
 *   migration 0279 records each of them as legacy (as does the startup
 *   backfill that creates the custom-oidc provider from its older config),
 *   so they keep signing in without any change at their IdP.
 * - `current` sends `/api/auth/callback/<id>`, the sign-in library's own
 *   default. A provider with no recorded style is current, which covers
 *   every provider created since; an admin can move a legacy provider onto
 *   it once the new URL is registered.
 *
 * Shared because the admin UI shows the URL and the server sends it, and the
 * two must never disagree.
 */

export type OidcRedirectStyle = 'legacy' | 'current'

export const OIDC_REDIRECT_STYLES = ['legacy', 'current'] as const

const LEGACY_CALLBACK_PREFIX = '/api/auth/oauth2/callback/'
const CURRENT_CALLBACK_PREFIX = '/api/auth/callback/'

/** Read-time default: anything other than an explicit `legacy` is current. */
export function oidcRedirectStyleFrom(stored: unknown): OidcRedirectStyle {
  return stored === 'legacy' ? 'legacy' : 'current'
}

export function oidcCallbackPath(registrationId: string, style: OidcRedirectStyle): string {
  const prefix = style === 'current' ? CURRENT_CALLBACK_PREFIX : LEGACY_CALLBACK_PREFIX
  return `${prefix}${registrationId}`
}

/** Absolute redirect URI for a provider, built from the server's base URL. */
export function oidcRedirectUri(
  baseUrl: string,
  registrationId: string,
  style: OidcRedirectStyle
): string {
  return `${baseUrl.replace(/\/+$/, '')}${oidcCallbackPath(registrationId, style)}`
}
