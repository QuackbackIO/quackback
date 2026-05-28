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
 *  - `quackback.sso.attempted` (sessionStorage): set to a **timestamp**
 *    when an attempt is mounted. Subsequent loads bail if the
 *    timestamp is within `ATTEMPTED_TTL_MS` of now, then auto-expire
 *    so a user who hit a transient failure (network blip, iframe
 *    blocked by an extension, etc.) doesn't get stuck for the rest
 *    of the tab's lifetime. The TTL is short enough to prevent
 *    reload-loops in pathological cases (a bad cookie that survives
 *    reload would still cooldown after one cycle) and long enough
 *    that a happy-path success → reload → mount sees signedIn=true
 *    and clears the flag cleanly before TTL matters.
 *  - `quackback.sso.suppressed` (sessionStorage, timestamp): set by
 *    the signout flow for in-tab protection against the brief race
 *    between "user clicked sign out" and "RP-initiated logout
 *    completes". Expires after `SUPPRESSED_TTL_MS` so a user who
 *    signs back in via the IdP elsewhere isn't stuck without auto
 *    sign-in until they close the tab — the suppression should
 *    only protect the immediate post-signout window. Cross-tab +
 *    cross-restart protection comes from RP-initiated logout
 *    itself, which destroys the IdP session so a fresh
 *    `prompt=none` returns `login_required` cleanly.
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
/** How long an `attempted` flag in sessionStorage keeps blocking
 *  re-tries. 60s is comfortably longer than the iframe `TIMEOUT_MS`
 *  (so back-to-back reloads can't ping-pong while an attempt is
 *  legitimately in-flight) and short enough that a user who hit a
 *  transient failure can recover by waiting ~a minute, or by closing
 *  and reopening the tab. */
const ATTEMPTED_TTL_MS = 60_000
/** How long the `suppressed` flag stays sticky after a signout. Long
 *  enough that an immediate "I signed out, now refresh" doesn't
 *  auto-re-auth (e.g. RP-initiated logout may still be in-flight,
 *  IdP session may not be dead yet). Short enough that a user who
 *  signs back into the IdP in another tab and comes back to this
 *  one isn't stuck signed-out until they close the tab. */
const SUPPRESSED_TTL_MS = 5 * 60_000

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

/** Mark silent SSO as suppressed for the current tab.
 *  Called from the signout path so an explicit logout doesn't race
 *  against an in-flight silent SSO attempt in the same tab during
 *  the brief window before RP-initiated logout navigates away.
 *  Cross-tab + cross-restart protection comes from RP-initiated
 *  logout destroying the IdP session — there's no need to make
 *  this flag durable. */
export function suppressSilentSso(): void {
  if (typeof window === 'undefined') return
  try {
    // Timestamp-based — read side checks against SUPPRESSED_TTL_MS
    // so the flag expires on its own. Prevents the "stuck signed-out
    // in this tab forever" failure mode after a signout when the
    // user signs back in via the IdP in another tab.
    window.sessionStorage.setItem(SUPPRESSED_KEY, String(Date.now()))
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
    window.sessionStorage.removeItem(SUPPRESSED_KEY)
    // Old durable flag from an earlier deploy — clear so users who
    // signed out under the previous code aren't permanently blocked
    // from silent SSO.
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

    let attempted = false
    try {
      const raw = window.sessionStorage.getItem(ATTEMPTED_KEY)
      if (raw) {
        // Legacy values stored the flag as `'1'`; treat any non-
        // numeric value as "attempted recently, just stale data" so
        // we honor it on this load and let the timestamp branch
        // refresh on the next set.
        const ts = Number(raw)
        if (Number.isFinite(ts) && ts > 0) {
          attempted = Date.now() - ts < ATTEMPTED_TTL_MS
          // Stale timestamp → garbage-collect so storage doesn't
          // accumulate values we'll never honor again.
          if (!attempted) window.sessionStorage.removeItem(ATTEMPTED_KEY)
        } else {
          attempted = true
        }
      }
      const suppressedRaw = window.sessionStorage.getItem(SUPPRESSED_KEY)
      if (suppressedRaw) {
        // Same shape as the `attempted` check — accept a timestamp,
        // tolerate the legacy `'1'` value as "suppressed, just stale
        // shape" so the deploy doesn't strand users mid-flow.
        const ts = Number(suppressedRaw)
        const stillActive =
          Number.isFinite(ts) && ts > 0 ? Date.now() - ts < SUPPRESSED_TTL_MS : true
        if (stillActive) return
        // Expired — clear so storage doesn't accumulate values we
        // won't honor again.
        window.sessionStorage.removeItem(SUPPRESSED_KEY)
      }
      // One-shot cleanup of the legacy durable flag from an earlier
      // deploy — anyone who signed out under that build still has
      // `localStorage['quackback.sso.suppressed'] = '1'` set and
      // would be permanently blocked from silent SSO. Clear it on
      // first encounter so behavior matches the new policy.
      if (window.localStorage.getItem(SUPPRESSED_KEY)) {
        window.localStorage.removeItem(SUPPRESSED_KEY)
      }
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
          // Timestamp-based — read side checks against ATTEMPTED_TTL_MS
          // to expire stale flags so users aren't permanently locked
          // out of silent SSO if an attempt errored partway through.
          window.sessionStorage.setItem(ATTEMPTED_KEY, String(Date.now()))
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
