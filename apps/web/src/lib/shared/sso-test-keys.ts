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
 * Better-Auth genericOAuth callback path for the legacy `sso` provider.
 * Kept for reference; new code should build per-provider paths from
 * `SSO_OAUTH_CALLBACK_PREFIX`.
 */
export const SSO_OAUTH_CALLBACK_PATH = '/api/auth/oauth2/callback/sso' as const

/**
 * Path prefix shared by every genericOAuth callback. The test flow uses
 * the provider's own production callback (`<prefix><registrationId>`) so
 * admins register exactly one redirect URI per provider. The auth catch-all
 * intercepts all paths under this prefix before handing off to Better-Auth
 * — a Redis miss for the OAuth `state` still falls through cleanly.
 */
export const SSO_OAUTH_CALLBACK_PREFIX = '/api/auth/oauth2/callback/' as const
