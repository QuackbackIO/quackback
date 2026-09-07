/**
 * SSO Test sign-in callback handler. Invoked by the auth catch-all for any
 * genericOAuth callback path before Better-Auth — a hit on the
 * `sso-test:<state>` Redis key dispatches the diagnostic handshake;
 * a miss falls through to a real OAuth sign-in.
 *
 * On a successful handshake this stamps the tested provider's
 * `lastSuccessfulTestAt` (via `persistTestResult`) to unlock its enforcement
 * gate. Mapping failures persist diagnostic capture without unlocking
 * enforcement. For the legacy `sso` provider it also stamps
 * `ssoOidc.lastSuccessfulTestAt` (via `markSsoTestSucceeded`) after the
 * provider stamp actually succeeds. Reports whether the IdP identity matched
 * the admin — informational only, not a gate.
 */

import { runHandshake } from '@/lib/server/auth/sso-test-handshake'
import {
  ssoTestSessionKey,
  ssoTestResultKey,
  SSO_TEST_POSTMESSAGE_SOURCE,
} from '@/lib/shared/sso-test-keys'
import { escapeHtmlAttr } from '@/lib/shared/utils/sanitize'
import { logger } from '@/lib/server/logger'
import type { SsoTestDiagnostic, TestSession } from '@/lib/server/functions/sso-test'

const log = logger.child({ component: 'sso-test-callback' })

const RESULT_TTL_SECONDS = 600

export interface SsoTestCallbackInput {
  state: string | null
  code: string | null
  error: string | null
  errorDescription: string | null
}

export interface SsoTestCallbackHandled {
  testId: string
  result: SsoTestDiagnostic['result']
  identityMatched: boolean
}

/**
 * Returns null when the request is NOT a Test sign-in callback (no
 * state, or state has no matching session in Redis). The caller should
 * fall through to Better-Auth in that case.
 *
 * Otherwise loads the per-state session, deletes it BEFORE running the
 * handshake (one-time-use replay defense), runs the OIDC handshake,
 * persists the wire-safe diagnostic for the polling fallback, and
 * returns the testId + diagnostic so the caller can render the popup
 * HTML.
 *
 * Isolation invariant: this path never writes `user.metadata`. The auth
 * catch-all intercepts the test callback before Better-Auth, so
 * `hooksAfter` (and `applyClaimAttributesAfter`) never run. A test
 * sign-in must not copy claims onto the admin's person attributes.
 */
export async function handleSsoTestCallback(
  input: SsoTestCallbackInput
): Promise<SsoTestCallbackHandled | null> {
  if (!input.state) return null

  const { cacheGet, cacheSet, cacheDel } = await import('@/lib/server/cache')

  const sessionKey = ssoTestSessionKey(input.state)
  const session = await cacheGet<TestSession>(sessionKey)
  if (!session) return null

  // One-time-use: delete before invoking the handshake so the
  // state/nonce can never be replayed even if the handshake hangs.
  await cacheDel(sessionKey)

  const result = await runHandshake({
    state: input.state,
    code: input.code,
    idpError: input.error,
    idpErrorDescription: input.errorDescription,
    expectedState: session.state,
    expectedNonce: session.nonce,
    // Discovery providers re-resolve from the doc; manual-endpoint providers
    // pass the endpoints resolved at start time (discoveryUrl is undefined).
    discoveryUrl: session.discoveryUrl,
    tokenEndpoint: session.tokenEndpoint,
    jwksUri: session.jwksUri,
    issuer: session.issuer,
    userinfoEndpoint: session.userinfoEndpoint,
    requestedScopes: session.requestedScopes,
    tokenAuth: session.tokenAuth,
    requestedPrompt: session.requestedPrompt,
    allowMissingEmail: session.allowMissingEmail,
    identityMapping: session.identityMapping,
    claimMapping: session.claimMapping,
    registrationId: session.registrationId,
    detailsChangedAtAtStart: session.detailsChangedAt,
    clientId: session.clientId,
    clientSecret: session.clientSecret,
    redirectUri: session.redirectUri,
    codeVerifier: session.codeVerifier,
  })

  // Strip the failure-branch `raw` debug field before persisting:
  // TanStack's serializable-input check rejects `unknown` payloads,
  // and SsoTestDiagnostic deliberately omits it.
  const wireResult: SsoTestDiagnostic['result'] = result.ok
    ? result
    : {
        ok: false,
        stage: result.stage,
        errorCode: result.errorCode,
        hint: result.hint,
        steps: result.steps,
        ...(result.mappingOutcome ? { mappingOutcome: result.mappingOutcome } : {}),
        ...(result.capture ? { capture: result.capture } : {}),
        ...(result.allClaims ? { allClaims: result.allClaims } : {}),
      }

  // Persist capture against the configuration the test started with. Success
  // stamps lastSuccessfulTestAt in the same conditional update; mapping
  // failure replaces diagnostic capture only. A mid-test edit yields a
  // zero-row update (stale) and cannot unlock enforcement.
  //
  // `identityMatched` is still computed — purely informational, shown
  // in the result panel as a "you tested as a different account" FYI —
  // but it does not gate anything.
  let identityMatched = false
  const capture = result.capture
  if (result.ok || capture) {
    const { listIdentityProviders, persistTestResult } =
      await import('@/lib/server/domains/settings/identity-providers.service')
    const providers = await listIdentityProviders()
    const provider = providers.find((p) => p.registrationId === session.registrationId)
    let stamped = false
    if (provider && capture) {
      const persist = await persistTestResult(provider.id, {
        expectedDetailsChangedAt: session.detailsChangedAt ?? null,
        outcome: result.ok ? 'success' : 'mapping_failed',
        capture,
      })
      stamped = persist === 'stamped' && result.ok
      if (stamped && session.registrationId === 'sso') {
        const { markSsoTestSucceeded } =
          await import('@/lib/server/domains/settings/settings.service')
        await markSsoTestSucceeded()
      }
    }

    log.info(
      {
        admin_user_id: session.adminUserId,
        registrationId: session.registrationId,
        stamped,
      },
      stamped
        ? 'sso test succeeded; provider gates unlocked'
        : result.ok
          ? 'sso test succeeded but provider changed mid-test; not stamping'
          : 'sso test mapping failed; capture stored without unlocking enforcement'
    )

    if (result.ok && result.claims.email) {
      const { db, user, eq } = await import('@/lib/server/db')
      type UserId = `user_${string}`
      const admin = await db.query.user.findFirst({
        where: eq(user.id, session.adminUserId as UserId),
        columns: { email: true },
      })
      const adminEmail = admin?.email?.toLowerCase().trim() ?? null
      const idpEmail = String(result.claims.email).toLowerCase().trim()
      identityMatched = !!adminEmail && !!idpEmail && adminEmail === idpEmail
    }
  }

  await cacheSet(
    ssoTestResultKey(session.testId),
    { result: wireResult, identityMatched } satisfies SsoTestDiagnostic,
    RESULT_TTL_SECONDS
  )

  return { testId: session.testId, result: wireResult, identityMatched }
}

/**
 * Renders the popup HTML the IdP redirect lands on. The page
 * postMessages the diagnostic back to the opener (with origin lock
 * to prevent stray listeners reading it) and auto-closes on success.
 *
 * `origin` MUST be the exact opener origin (typically the request URL
 * origin) so postMessage does not fall back to "*".
 */
export function renderSsoTestCallbackHtml({
  testId,
  result,
  origin,
  identityMatched,
}: {
  testId: string
  result: SsoTestDiagnostic['result']
  origin: string
  identityMatched: boolean
}): Response {
  const payload = jsSafeJson({
    source: SSO_TEST_POSTMESSAGE_SOURCE,
    testId,
    result,
    identityMatched,
  })

  const escapedOrigin = JSON.stringify(origin)

  const heading = 'SSO test sign-in'
  const body = result.ok
    ? '<p style="color:#15803d;font-size:0.875rem">Sign-in succeeded. This window will close automatically.</p>'
    : `<div style="font-size:0.875rem">
         <p style="color:#b91c1c;font-weight:500">Test failed at: ${escapeHtmlAttr(
           result.stage
         )}</p>
         <p style="margin-top:0.5rem;color:#6b7280">${escapeHtmlAttr(result.hint)}</p>
       </div>`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${heading}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 1.5rem; max-width: 36rem; margin: 0 auto; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
  .footer { margin-top: 1rem; font-size: 0.75rem; color: #6b7280; }
</style>
</head>
<body>
<h1>${heading}</h1>
${body}
<p class="footer">You can close this window. Results will appear in the original tab.</p>
<script>
(function () {
  var payload = ${payload};
  try {
    if (window.opener) {
      window.opener.postMessage(payload, ${escapedOrigin});
    }
  } catch (e) { /* opener gone — polling fallback covers it */ }
  if (payload.result && payload.result.ok) {
    setTimeout(function () { window.close(); }, 1500);
  }
})();
</script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

// JS-safe JSON: encode the payload so IdP-controlled fields
// (error_description, etc.) cannot close our inline `<script>` tag
// or break out of the JSON literal as a JS string. JSON.parse
// reads the original characters back at runtime in the browser.
const SCRIPT_BREAKERS = new RegExp('[<>&\\u2028\\u2029]', 'g')
const SCRIPT_BREAKER_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  ['\u2028']: '\\u2028',
  ['\u2029']: '\\u2029',
}

function jsSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(SCRIPT_BREAKERS, (c) => SCRIPT_BREAKER_ESCAPES[c]!)
}
