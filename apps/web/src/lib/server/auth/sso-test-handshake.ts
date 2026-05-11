/**
 * Pure OIDC handshake driver for the admin "Test sign-in" feature.
 *
 * Imports NOTHING from db/session/user/account tables. The handshake
 * is purely an outbound-fetch + token-decode + claim-check pipeline.
 * Statically guarantees a test run cannot create a session or mutate
 * user state.
 *
 * Each stage returns a structured result so the UI can render per-stage
 * status. On failure, includes an error code AND a human-readable hint
 * sourced from `oidc-error-explain.ts`.
 */

import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader, decodeJwt } from 'jose'
import { explainAuthorizeError, explainTokenError } from './oidc-error-explain'

export type HandshakeStage =
  | 'state-validation'
  | 'idp-authorize'
  | 'discovery-fetch'
  | 'token-exchange'
  | 'id-token-decode'
  | 'signature-verify'
  | 'claim-check'
  | 'userinfo'

export interface HandshakeInput {
  state: string | null
  code: string | null
  expectedState: string
  expectedNonce: string
  discoveryUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  /** IdP-returned `error` query parameter, if the authorize step failed. */
  idpError?: string | null
  idpErrorDescription?: string | null
}

export interface DiagnosticStep {
  ok: boolean
  stage: HandshakeStage
  label: string
  detail?: string
}

export type HandshakeResult =
  | {
      ok: true
      steps: DiagnosticStep[]
      claims: {
        iss: string
        sub: string
        aud: string | string[]
        email?: string
        email_verified?: boolean
        name?: string
        preferred_username?: string
      }
      tokenInfo: {
        idTokenAlg: string
        hasAccessToken: boolean
        hasRefreshToken: boolean
        expiresIn?: number
      }
    }
  | {
      ok: false
      stage: HandshakeStage
      errorCode?: string
      hint: string
      raw?: unknown
      steps: DiagnosticStep[]
    }

export async function runHandshake(input: HandshakeInput): Promise<HandshakeResult> {
  const steps: DiagnosticStep[] = []

  if (input.idpError) {
    return {
      ok: false,
      stage: 'idp-authorize',
      errorCode: input.idpError,
      hint: explainAuthorizeError(input.idpError, input.idpErrorDescription),
      steps,
    }
  }

  if (!input.state || !input.code) {
    return {
      ok: false,
      stage: 'state-validation',
      hint: 'The IdP redirect did not include a state or code parameter. Check that your authorization-code grant is enabled on the IdP application.',
      steps,
    }
  }
  if (input.state !== input.expectedState) {
    return {
      ok: false,
      stage: 'state-validation',
      hint: 'State mismatch. Possible CSRF, replay, or expired test session. Start the test again.',
      steps,
    }
  }
  steps.push({ ok: true, stage: 'state-validation', label: 'State validated' })

  const discoveryRes = await fetch(input.discoveryUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  })
  if (!discoveryRes.ok) {
    return {
      ok: false,
      stage: 'discovery-fetch',
      hint: `Discovery URL returned ${discoveryRes.status}. Check the URL and IdP availability.`,
      steps,
    }
  }
  const discovery = (await discoveryRes.json()) as {
    issuer: string
    token_endpoint: string
    jwks_uri: string
    userinfo_endpoint?: string
  }

  // SSRF-check every sub-endpoint the discovery doc names. A malicious
  // or compromised IdP could point token_endpoint / jwks_uri at private
  // IPs and use the handshake to probe our internal network. Mirrors
  // testSsoConnectionFn's existing pattern (apps/web/src/lib/server/
  // functions/sso.ts:172-187).
  const { checkUrlSafety } = await import('@/lib/server/content/ssrf-guard')
  const subEndpoints = [
    { name: 'token_endpoint', url: discovery.token_endpoint },
    { name: 'jwks_uri', url: discovery.jwks_uri },
    ...(discovery.userinfo_endpoint
      ? [{ name: 'userinfo_endpoint', url: discovery.userinfo_endpoint }]
      : []),
  ]
  for (const ep of subEndpoints) {
    const safety = await checkUrlSafety(ep.url)
    if (!safety.safe) {
      return {
        ok: false,
        stage: 'discovery-fetch',
        hint: `Discovery doc's ${ep.name} (${ep.url}) is not safe to fetch (private/loopback IP or invalid scheme). The IdP may be misconfigured.`,
        steps,
      }
    }
  }
  steps.push({
    ok: true,
    stage: 'discovery-fetch',
    label: 'Discovery doc fetched and endpoints validated',
  })

  // Mirror production: Better-Auth's genericOAuth plugin does NOT enable
  // PKCE in our config, so the test flow must not send code_verifier
  // either. Adding PKCE here would test a slightly-different protocol
  // and produce false positives.
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })
  const tokenRes = await fetch(discovery.token_endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: tokenBody,
    signal: AbortSignal.timeout(10_000),
  })
  if (!tokenRes.ok) {
    const errBody = (await tokenRes.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
    }
    return {
      ok: false,
      stage: 'token-exchange',
      errorCode: errBody.error,
      hint: explainTokenError(errBody.error, errBody.error_description, tokenRes.status),
      raw: errBody,
      steps,
    }
  }
  const tokens = (await tokenRes.json()) as {
    id_token?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }
  if (!tokens.id_token) {
    return {
      ok: false,
      stage: 'token-exchange',
      hint: "No id_token returned. Make sure 'openid' is in the requested scopes and your IdP is configured to issue ID tokens for authorization-code grants.",
      steps,
    }
  }
  steps.push({ ok: true, stage: 'token-exchange', label: 'Token exchange succeeded' })

  const header = decodeProtectedHeader(tokens.id_token)
  steps.push({
    ok: true,
    stage: 'id-token-decode',
    label: 'ID token decoded',
    detail: `alg=${header.alg ?? '?'} kid=${header.kid ?? '?'}`,
  })

  let verifiedPayload: ReturnType<typeof decodeJwt>
  try {
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: discovery.issuer,
      audience: input.clientId,
    })
    verifiedPayload = payload
  } catch (err) {
    return {
      ok: false,
      stage: 'signature-verify',
      hint: `ID token signature verification failed: ${err instanceof Error ? err.message : 'unknown error'}. Likely causes: JWKS rotation, wrong issuer, or 'aud' claim does not include your client_id.`,
      steps,
    }
  }
  steps.push({ ok: true, stage: 'signature-verify', label: 'Signature verified against JWKS' })

  if (verifiedPayload.nonce !== input.expectedNonce) {
    return {
      ok: false,
      stage: 'claim-check',
      hint: 'Nonce mismatch in ID token. Possible replay attack or IdP not honoring nonce.',
      steps,
    }
  }
  steps.push({ ok: true, stage: 'claim-check', label: 'Nonce matched' })

  if (!verifiedPayload.email) {
    return {
      ok: false,
      stage: 'claim-check',
      hint: "ID token has no 'email' claim. Quackback requires an email to create users. Configure your IdP's claim mapper to release the email claim (Keycloak: client scopes; Okta: claim mappers; Entra: API permissions + admin consent).",
      steps,
    }
  }
  steps.push({
    ok: true,
    stage: 'claim-check',
    label: 'Email claim present',
    detail: typeof verifiedPayload.email === 'string' ? verifiedPayload.email : undefined,
  })

  if (discovery.userinfo_endpoint && tokens.access_token) {
    try {
      const uiRes = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      })
      steps.push({
        ok: uiRes.ok,
        stage: 'userinfo',
        label: uiRes.ok ? 'Userinfo endpoint reachable' : `Userinfo failed (${uiRes.status})`,
      })
    } catch {
      steps.push({ ok: false, stage: 'userinfo', label: 'Userinfo unreachable (timeout)' })
    }
  }

  return {
    ok: true,
    steps,
    claims: {
      iss: verifiedPayload.iss as string,
      sub: verifiedPayload.sub as string,
      aud: verifiedPayload.aud as string | string[],
      email: verifiedPayload.email as string,
      email_verified: verifiedPayload.email_verified as boolean | undefined,
      name: verifiedPayload.name as string | undefined,
      preferred_username: verifiedPayload.preferred_username as string | undefined,
    },
    tokenInfo: {
      idTokenAlg: (header.alg ?? 'unknown') as string,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    },
  }
}
