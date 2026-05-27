/**
 * Silent SSO bootstrap — attempts a zero-click OIDC sign-in via a
 * hidden iframe with `prompt=none`.
 *
 * Why this exists: users coming from a sister app that shares the
 * same IdP (e.g. InterpriseOne) already have a Better-Auth session
 * on the IdP's domain. The OIDC spec's `prompt=none` flow lets us
 * complete the authorization-code dance without ever rendering a
 * login page — the IdP either returns a code immediately (session
 * present) or returns `error=login_required` (session missing).
 *
 * Mechanics:
 *  1. Ask Better-Auth for the IdP authorize URL via the same
 *     `signIn.oauth2` call the popup button uses, with
 *     `disableRedirect: true` so we get the URL back instead of a
 *     top-window navigation. Better-Auth still seeds the state
 *     cookies needed for callback validation.
 *  2. Force `prompt=none` into the authorize URL's query.
 *  3. Mount a hidden iframe pointing at that URL.
 *  4. On success the iframe lands on `/auth/auth-complete`, which
 *     posts to the `quackback-auth` BroadcastChannel; our listener
 *     reloads the page so route loaders pick up the new session.
 *  5. On failure (no IdP session, blocked by CSP, etc.) the iframe
 *     ends up on a same-origin URL that is NOT
 *     `/auth/auth-complete` — typically `/api/auth/error` or the
 *     login page. We detect that via the iframe's `onload` event
 *     and silently remove the iframe; the host page renders as
 *     normal.
 *
 * Loop / UX guards:
 *  - `quackback.sso.attempted` (sessionStorage): set once an attempt
 *    is mounted, cleared only after the post-success reload has
 *    actually produced a signed-in session (verified by route
 *    context). Prevents a reload-loop when the cookie was set but
 *    the route loader refuses to recognise the session for some
 *    other reason.
 *  - `quackback.sso.suppressed` (localStorage): set by the signout
 *    flow so a user who explicitly signed out doesn't get yanked
 *    straight back in — even if they close the tab and open a new
 *    one. Cleared only when the user explicitly opts back into SSO
 *    (clicks "Continue with SSO" on a login page) or by an admin
 *    clearing site data. Defense-in-depth alongside RP-initiated
 *    logout, which destroys the IdP session itself.
 */
import { useEffect, useRef } from 'react'
import { authClient } from '@/lib/client/auth-client'

const ATTEMPTED_KEY = 'quackback.sso.attempted'
const SUPPRESSED_KEY = 'quackback.sso.suppressed'
const CHANNEL_NAME = 'quackback-auth'
const AUTH_COMPLETE_PATH = '/auth/auth-complete'
/** How long to wait before assuming the IdP isn't going to respond
 *  (network down, CSP `frame-ancestors` blocked us, etc.). 8s is long
 *  enough for a slow IdP discovery + redirect round-trip and short
 *  enough that a flaky path doesn't leak a hidden network request. */
const TIMEOUT_MS = 8000

export interface UseSilentSsoOptions {
  /** Whether the `sso` provider is registered for this workspace.
   *  Driven from the root route context's `registeredAuthProviders`
   *  array so we don't fire a no-op attempt on tenants that haven't
   *  configured an IdP. */
  enabled: boolean
  /** Whether the user already has a Quackback session. Skips the
   *  attempt entirely when truthy (no point silently re-signing-in
   *  someone who's already signed in). */
  signedIn: boolean
}

/** Mark silent SSO as suppressed across browser tabs / restarts.
 *  Called from the signout path so an explicit logout doesn't get
 *  immediately undone on the next page load — even if the user
 *  closes the tab and opens a new one. Lives in localStorage so it
 *  survives sessionStorage's tab-scope reset. */
export function suppressSilentSso(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SUPPRESSED_KEY, '1')
    // Also clear the (sessionStorage-scoped) attempted counter so a
    // future explicit SSO sign-in gets a fresh attempt budget.
    window.sessionStorage.removeItem(ATTEMPTED_KEY)
  } catch {
    /* storage disabled (private mode) — silent SSO will still
       respect the in-memory guard within a single load. */
  }
}

/** Clear the suppress flag — used when the user explicitly opts back
 *  into SSO (e.g. clicks "Continue with SSO" on the login form). */
export function clearSilentSsoSuppression(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SUPPRESSED_KEY)
  } catch {
    /* noop */
  }
}

export function useSilentSso({ enabled, signedIn }: UseSilentSsoOptions): void {
  // Single-fire guard within a React render lifetime. sessionStorage
  // covers across-page-loads; this covers StrictMode double-invoke
  // and quick re-renders.
  const ranRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!enabled) return
    if (ranRef.current) return

    // Two storage scopes intentionally — sessionStorage for the
    // per-tab "did we already try this load" counter, and
    // localStorage for the cross-tab "user opted out" flag.
    let attempted = false
    try {
      attempted = !!window.sessionStorage.getItem(ATTEMPTED_KEY)
      const suppressed = !!window.localStorage.getItem(SUPPRESSED_KEY)
      if (suppressed) return
    } catch {
      /* If storage throws we fall through and rely on the ranRef
         guard — worst case is one extra attempt per load. */
    }

    // Verify-before-clear: if a previous attempt left
    // `attempted=true` AND we now have a real session
    // (signedIn=true), the silent flow succeeded and the post-reload
    // route context confirms it — safe to clear so a future signout
    // resets the budget cleanly.
    if (signedIn) {
      if (attempted) {
        try {
          window.sessionStorage.removeItem(ATTEMPTED_KEY)
        } catch {
          /* noop */
        }
      }
      return
    }

    // Not signed in but previous attempt already mounted an iframe
    // this tab — don't re-fire. The user can manually click
    // "Continue with SSO" to retry, which also clears suppression.
    if (attempted) return

    ranRef.current = true

    let cancelled = false
    let iframe: HTMLIFrameElement | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const channel = new BroadcastChannel(CHANNEL_NAME)

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      try {
        channel.close()
      } catch {
        /* already closed */
      }
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
      }
      iframe = null
    }

    channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type !== 'auth-success') return
      cleanup()
      // Intentionally LEAVE `attempted=true` set. The next mount,
      // post-reload, will see `signedIn=true` from route context and
      // clear it then. If the reload somehow fails to pick up a
      // session (loader bug, cookie eaten, etc.), `attempted` stays
      // set and we don't ping-pong reload forever.
      // Reload so TanStack Router's beforeLoad re-runs with the new
      // session cookie — the user lands on whatever page they
      // originally requested, now signed in.
      window.location.reload()
    }
    ;(async () => {
      try {
        const result = await authClient.signIn.oauth2({
          providerId: 'sso',
          // On success the iframe ends up here, which posts back
          // over BroadcastChannel and closes (see auth-complete.tsx).
          callbackURL: AUTH_COMPLETE_PATH,
          disableRedirect: true,
        })
        if (cancelled) return
        const url = result.data?.url
        if (!url) {
          cleanup()
          return
        }

        // Force `prompt=none` regardless of what Better-Auth seeded.
        // Hard-setting here is more robust than threading it through
        // `additionalData` (which is provider-config-dependent) and
        // is idempotent if it was already set.
        const authorizeUrl = new URL(url)
        authorizeUrl.searchParams.set('prompt', 'none')

        try {
          window.sessionStorage.setItem(ATTEMPTED_KEY, '1')
        } catch {
          /* noop — the ranRef guard still prevents in-memory loop */
        }

        const el = document.createElement('iframe')
        el.style.position = 'fixed'
        el.style.width = '0'
        el.style.height = '0'
        el.style.border = '0'
        el.style.visibility = 'hidden'
        el.setAttribute('aria-hidden', 'true')
        el.setAttribute('tabindex', '-1')
        el.title = 'Silent SSO'

        el.onload = () => {
          // We can only read `contentWindow.location` when the
          // iframe is same-origin. While bouncing through the IdP
          // (api.interprise.one, etc.) this throws and we keep
          // waiting. Once the iframe lands back on our own origin
          // we either see /auth/auth-complete (success, handled by
          // the BroadcastChannel listener above) or anywhere else
          // (failure — Better-Auth's /api/auth/error, the login
          // page, etc.) and silently tear down.
          try {
            const loc = el.contentWindow?.location
            if (!loc) return
            if (loc.origin !== window.location.origin) return
            if (loc.pathname === AUTH_COMPLETE_PATH) return
            cleanup()
          } catch {
            /* cross-origin — still on the IdP */
          }
        }

        iframe = el
        document.body.appendChild(el)
        el.src = authorizeUrl.toString()

        // Failsafe: if the IdP never redirects back (CSP-blocked,
        // network outage, frame busted), tear down so we don't
        // leak a hidden request indefinitely. The `attempted` flag
        // is left set so we don't immediately retry.
        timeoutId = setTimeout(cleanup, TIMEOUT_MS)
      } catch {
        cleanup()
      }
    })()

    return () => {
      cancelled = true
      cleanup()
    }
  }, [enabled, signedIn])
}
