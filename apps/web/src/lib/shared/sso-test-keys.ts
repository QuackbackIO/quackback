/**
 * Shared cache-key and postMessage-source constants for the admin
 * "Test sign-in" flow.
 *
 * Three call sites reach into the same key space: the server function
 * that mints sessions and reads diagnostics, the callback route that
 * persists the handshake result, and the client button that polls and
 * listens for postMessage. Centralising the strings keeps them in sync
 * and gives `grep` a single point of truth.
 */

export const SSO_TEST_CACHE_PREFIX = 'sso-test:'

export function ssoTestSessionKey(state: string): string {
  return `${SSO_TEST_CACHE_PREFIX}${state}`
}

export function ssoTestResultKey(testId: string): string {
  return `${SSO_TEST_CACHE_PREFIX}result:${testId}`
}

/**
 * Source tag the callback page stamps on its postMessage and the
 * Test-sign-in button screens for. Origin check still happens at the
 * listener; this exists only to filter unrelated messages on the same
 * origin (browser extensions, devtools, other tabs).
 */
export const SSO_TEST_POSTMESSAGE_SOURCE = 'quackback-sso-test' as const

/**
 * Pre-1.7 generic OAuth callback. Sign-in and Test sign-in no longer send
 * this URL. The catch-all still intercepts it so a return to a previously
 * registered redirect URI can finish a test or be rewritten onto Better Auth.
 */
export const SSO_OAUTH_CALLBACK_PREFIX = '/api/auth/oauth2/callback/' as const

/**
 * Callback Better Auth 1.7 sends for social and generic OIDC providers.
 * Test sign-in uses the same prefix so one IdP registration covers both.
 */
export const SSO_SOCIAL_CALLBACK_PREFIX = '/api/auth/callback/' as const

export function isSsoTestCallbackPath(pathname: string): boolean {
  return (
    pathname.startsWith(SSO_OAUTH_CALLBACK_PREFIX) ||
    pathname.startsWith(SSO_SOCIAL_CALLBACK_PREFIX)
  )
}
