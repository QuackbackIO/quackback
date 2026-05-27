/**
 * Build the IdP's RP-initiated logout URL so that signing out of
 * Quackback also signs the user out of the upstream IdP (per OIDC
 * Session Management 1.0 / RP-Initiated Logout 1.0).
 *
 * Without this, "Sign out" of Quackback only clears Quackback's own
 * session cookie. The IdP session stays alive, and the next page
 * load triggers `useSilentSso` which silently re-signs the user back
 * in — defeating the user's expectation that Sign Out means signed
 * out.
 *
 * Mechanics:
 *  1. Read the workspace's SSO config (discovery URL + client ID).
 *     If SSO isn't enabled, returns null — caller falls back to the
 *     standard "clear local session and redirect to /auth/login"
 *     flow.
 *  2. Fetch the OIDC discovery document to find the
 *     `end_session_endpoint` (Better-Auth's `oidcProvider` publishes
 *     it at `${baseURL}/oauth2/endsession`; standard IdPs do too).
 *  3. Construct the logout URL with `client_id` +
 *     `post_logout_redirect_uri` set so the IdP redirects back to
 *     Quackback after clearing its session. The redirect URL MUST
 *     be pre-registered on the IdP's trusted-client allowlist —
 *     see the IdP-side comment in InterpriseOne's `server/src/lib/
 *     auth.ts` (`QUACKBACK_OIDC_REDIRECT_URL` env).
 *  4. Returns the URL string. The client wrapper around `signOut`
 *     does a top-window navigation there after Better-Auth has
 *     cleared the local cookie.
 *
 * If the discovery fetch fails or the IdP doesn't publish
 * `end_session_endpoint`, returns null and the caller falls back to
 * local-only logout + a localStorage suppression flag (the
 * defense-in-depth `quackback.sso.suppressed` key consumed by
 * `useSilentSso`). The fallback is safe — the user just won't be
 * signed out of the IdP, but silent SSO will be suppressed for the
 * lifetime of the browser profile.
 */

import { createServerFn } from '@tanstack/react-start'

export interface SsoLogoutInfo {
  /** Full URL the browser should navigate to. */
  url: string
}

/** 5s discovery fetch timeout. Logout is interactive; we don't want
 *  the user staring at a "signing out…" screen for 30 seconds if the
 *  IdP discovery doc is slow. Falling back to local-only logout is
 *  fine. */
const DISCOVERY_TIMEOUT_MS = 5000

export const getSsoLogoutUrlFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SsoLogoutInfo | null> => {
    try {
      const [{ getTenantSettings }, { getBaseUrl }] = await Promise.all([
        import('@/lib/server/domains/settings/settings.service'),
        import('@/lib/server/config'),
      ])

      const tenant = await getTenantSettings()
      const sso = tenant?.authConfig?.ssoOidc
      if (!sso?.enabled || !sso.discoveryUrl || !sso.clientId) {
        return null
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
      let discovery: { end_session_endpoint?: string } | null = null
      try {
        const res = await fetch(sso.discoveryUrl, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })
        if (res.ok) discovery = (await res.json()) as { end_session_endpoint?: string }
      } catch {
        // SSRF / network / timeout — fall through to null.
      } finally {
        clearTimeout(timer)
      }

      const endSessionEndpoint = discovery?.end_session_endpoint
      if (!endSessionEndpoint) return null

      let url: URL
      try {
        url = new URL(endSessionEndpoint)
      } catch {
        return null
      }
      // Only https is acceptable for a real IdP — http is allowed in
      // dev mode (localhost) for parity with how the rest of our SSO
      // surface treats discovery URLs.
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

      url.searchParams.set('client_id', sso.clientId)
      // Land on the public sign-in page after IdP logout. The post-
      // logout URL must be registered on the IdP's trusted client.
      const baseUrl = getBaseUrl()
      url.searchParams.set('post_logout_redirect_uri', `${baseUrl}/auth/sso-logout-complete`)

      return { url: url.toString() }
    } catch (error) {
      console.error('[fn:sso-logout] getSsoLogoutUrlFn failed:', error)
      return null
    }
  }
)
