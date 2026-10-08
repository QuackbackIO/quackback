/**
 * Better Auth endpoints closed to HTTP.
 *
 * `disabledPaths` is checked by Better Auth's router only, so every endpoint
 * here stays callable in process through `auth.api.*`.
 *
 * - `/token`: the JWT plugin's endpoint, which conflicts with OAuth's
 *   `/oauth2/token`. Does not affect magic links or sessions.
 * - `/email-otp/request-email-change` and `/email-otp/change-email`: changing
 *   the account's address. They are reached through `functions/contact-email.ts`,
 *   which first proves the current address and applies the domain rules.
 *   Called directly, they need nothing but a session.
 */
export const HTTP_DISABLED_AUTH_PATHS = [
  '/token',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
]
