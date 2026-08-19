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
import { AUTH_BLOCK_MESSAGES, type AuthBlockCode } from '@/lib/shared/auth-block-messages'

// The code union + message map live in `@/lib/shared/auth-block-messages`
// so client-bundled route files can render them without importing server
// code. Re-exported here so existing server/component importers keep one
// canonical path.
export { AUTH_BLOCK_MESSAGES, type AuthBlockCode }

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
 * Inspect a Response to see if it was redirected to a sign-in error
 * URL. Detection is code-based (not path-based): the `error` query
 * param must be a known code in `AUTH_BLOCK_MESSAGES`. This catches
 * both the canonical `/?auth=signin&error=<code>` destination and any
 * legacy `/auth/login?error=<code>` shape without relying on a
 * hard-coded path allowlist.
 *
 * Returns null when:
 *  - the response was not redirected
 *  - there is no `error` param in the final URL
 *  - the `error` value is not a known AUTH_BLOCK_MESSAGES code
 *
 * Exported so the onResponse hook stays a one-liner and the detection
 * logic is unit-testable without a real Response.
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
  const code = parsed.searchParams.get('error')
  if (!code) return null
  const message = AUTH_BLOCK_MESSAGES[code as AuthBlockCode]
  if (!message) return null
  return new AuthBlockedError(code, message)
}
