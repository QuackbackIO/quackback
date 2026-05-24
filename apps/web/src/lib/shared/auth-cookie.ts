/**
 * Auth cookie name constants.
 *
 * Better-Auth namespaces every cookie it owns with a configurable
 * prefix (`advanced.cookiePrefix`). We override the stock default of
 * `"better-auth"` because Quackback is commonly deployed alongside
 * other Better-Auth apps on the same eTLD+1 (e.g. `feedback.acme.com`
 * next to `app.acme.com`), and the sibling app frequently scopes its
 * session cookie to the apex with `Domain=.acme.com`. When both apps
 * use the stock prefix, both cookies share the name
 * `__Secure-better-auth.session_token`; the browser hands BOTH to
 * Quackback on every request, and Better-Auth's cookie parser picks
 * whichever value the header serialiser yields first — frequently the
 * sibling's apex value, which Quackback can't validate. Result:
 * `getSession()` returns null, every workspace guard bounces to
 * `/admin/login`, and the user is stuck in a sign-in loop with no
 * server-side breadcrumb because no error was thrown.
 *
 * Namespacing under `"quackback"` guarantees the cookie name is
 * disjoint from any sibling Better-Auth app, regardless of which app
 * sets its cookie with a broader Domain attribute. This is purely a
 * naming change — the cryptographic scoping is unaffected.
 *
 * If you change the prefix here, also re-run the Quackback rollout
 * with the understanding that every currently-signed-in user gets
 * logged out (their stored cookie still uses the old name, which
 * Better-Auth now ignores).
 */
export const AUTH_COOKIE_PREFIX = 'quackback'

/**
 * Bare session-token cookie name (no `__Secure-` prefix). Use this for
 * substring checks against the raw `Cookie` request header — it
 * matches both the http (`quackback.session_token`) and https
 * (`__Secure-quackback.session_token`) variants in one pass.
 *
 * Better-Auth picks the `__Secure-` prefix at runtime based on the
 * resolved BASE_URL protocol (see `cookies/index.mjs:20`); we don't
 * want to fork the check by environment in every consumer.
 */
export const SESSION_TOKEN_COOKIE_NAME = `${AUTH_COOKIE_PREFIX}.session_token`
