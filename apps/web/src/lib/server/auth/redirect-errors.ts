/**
 * Pre-check redirect surfacing for the better-auth client.
 *
 * When `handleSignInPreCheck` blocks a sign-in (rate-limited,
 * verified-domain hard-bound, the method is disabled for the
 * principal's audience), it returns a 302 to /admin/login or
 * /auth/login with `?error=<code>`. fetch follows the redirect by
 * default, the auth client parses the (HTML) body as null JSON, and
 * the awaiting form sees `{ data: null, error: null }` — interpreted
 * as success. The form fires its `onSuccess` path and the popover
 * silently closes with no session and no message.
 *
 * `detectAuthBlockRedirect` lets the client's `onResponse` hook turn
 * those redirects into a thrown `AuthBlockedError` so the form's
 * existing try/catch surfaces a friendly message.
 *
 * The exported `AUTH_BLOCK_MESSAGES` map is also imported by
 * `/admin/login` (and any future surface that consumes a pre-check
 * error code) so the wording stays in one place.
 */
import { ForbiddenError } from '@/lib/shared/errors'

/** Closed set of codes `handleSignInPreCheck` and `auth-restrictions`
 *  emit. Adding a producer-side code without listing it here makes
 *  the auth client fall back to the generic message — TypeScript
 *  won't catch that for you because the producer side types these as
 *  `error?: string`. Keep both sides in sync. */
export type AuthBlockCode =
  | 'password_method_not_allowed'
  | 'magic_link_method_not_allowed'
  | 'oauth_method_not_allowed'
  | 'auth_method_blocked'
  | 'rate_limited'
  | 'verified_domain_requires_sso'
  | 'require_two_factor'
  | 'token_expired'
  | 'invalid_token'
  | 'signup_disabled'
  | 'OAUTH_CALLBACK_ERROR'
  | 'oauth_signin_error'
  | 'not_team_member'

export const AUTH_BLOCK_MESSAGES: Record<AuthBlockCode, string> = {
  password_method_not_allowed:
    "Password sign-in isn't enabled for this workspace. Try magic-link or SSO instead.",
  magic_link_method_not_allowed: "Magic-link sign-in isn't enabled for this workspace.",
  oauth_method_not_allowed: "That sign-in provider isn't enabled for this workspace.",
  auth_method_blocked: "That sign-in method isn't allowed for your account.",
  rate_limited: 'Too many sign-in attempts. Please wait a moment and try again.',
  verified_domain_requires_sso:
    'Your email is on a domain that requires single sign-on. Use the SSO option to continue.',
  require_two_factor: 'Two-factor authentication is required. Please verify your second factor.',
  token_expired: 'Your login link has expired. Please request a new one.',
  invalid_token: 'Your login link is invalid or has been tampered with. Please try again.',
  signup_disabled:
    "Your account isn't pre-provisioned for SSO. Ask an administrator to invite you first.",
  OAUTH_CALLBACK_ERROR:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
  oauth_signin_error:
    'Sign-in failed. Your identity provider rejected the request — check the app configuration in your IdP and try again.',
  not_team_member:
    "This account doesn't have team access. Team membership is by invitation only. Please contact your administrator.",
}

const LOGIN_PATHS = new Set(['/admin/login', '/auth/login'])

const GENERIC_BLOCK_MESSAGE = "Sign-in isn't allowed right now. Please try again."

/**
 * 403 domain error for pre-check denials. Extending `ForbiddenError`
 * keeps the auth-client throw path on the same hierarchy the rest of
 * the codebase catches via `DomainException` / `instanceof`.
 */
export class AuthBlockedError extends ForbiddenError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'AuthBlockedError'
  }
}

/**
 * Inspect a Response to see if it was redirected to a login error
 * page. Returns the corresponding error to throw, or null if this
 * was a normal response. Exported so the onResponse hook stays a
 * one-liner and the detection logic is unit-testable without a real
 * Response.
 */
export function detectAuthBlockRedirect(response: {
  redirected: boolean
  url: string
}): AuthBlockedError | null {
  if (!response.redirected) return null
  let parsed: URL
  try {
    parsed = new URL(response.url)
  } catch {
    return null
  }
  if (!LOGIN_PATHS.has(parsed.pathname)) return null
  const code = parsed.searchParams.get('error')
  if (!code) return null
  const message = AUTH_BLOCK_MESSAGES[code as AuthBlockCode] ?? GENERIC_BLOCK_MESSAGE
  return new AuthBlockedError(code, message)
}
