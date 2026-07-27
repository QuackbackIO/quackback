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

import { jwtVerify, createLocalJWKSet, decodeProtectedHeader, decodeJwt } from 'jose'
import type { JsonValue } from '@/lib/server/audit/log'
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
  /** Present for discovery providers (endpoints fetched from the doc). Absent
   *  for manual-endpoint providers, which pass the resolved endpoints below. */
  discoveryUrl?: string
  /** Pre-resolved endpoints for manual-endpoint providers (no discovery doc). */
  tokenEndpoint?: string
  jwksUri?: string
  issuer?: string
  userinfoEndpoint?: string
  clientId: string
  clientSecret: string
  redirectUri: string
  /** PKCE verifier minted at authorize time (S256 challenge). */
  codeVerifier: string
  /** The scopes this attempt actually requested, so an invalid_scope hint can
   *  name them instead of asserting a default set. */
  requestedScopes?: readonly string[]
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
      /** Full decoded ID-token payload, exactly as the IdP returned it. Lets
       *  admins see non-standard claims (groups, roles, ...) when debugging
       *  claim-to-role mapping. The curated `claims` above is for the friendly
       *  display + identity match; this is the complete set. */
      allClaims?: Record<string, JsonValue>
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
      hint: explainAuthorizeError(input.idpError, input.idpErrorDescription, input.requestedScopes),
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

  // Every sub-endpoint we fetch below (token_endpoint, jwks_uri,
  // userinfo_endpoint) is pinned by its own SSRF-safe safeFetch call (validate,
  // connect to the validated IP, never follow redirects), so a hostile
  // discovery doc or manual endpoint can't point us at the internal network.
  const { safeFetch, SsrfError } = await import('@/lib/server/content/ssrf-guard')

  // Resolve the IdP's issuer + endpoints: fetch the discovery doc for discovery
  // providers, or use the manually-configured endpoints for installs with no
  // discovery document. The rest of the handshake is identical either way.
  let discovery: {
    issuer: string
    token_endpoint: string
    jwks_uri: string
    userinfo_endpoint?: string
  }
  if (input.discoveryUrl) {
    let discoveryRes: Response
    try {
      discoveryRes = await safeFetch(input.discoveryUrl, { timeoutMs: 5000 })
    } catch (err) {
      if (err instanceof SsrfError) {
        return {
          ok: false,
          stage: 'discovery-fetch',
          hint: `Discovery URL (${input.discoveryUrl}) is not safe to fetch (${err.reason}). Use a public IdP URL.`,
          steps,
        }
      }
      return {
        ok: false,
        stage: 'discovery-fetch',
        hint: `Discovery URL could not be reached: ${err instanceof Error ? err.message : 'network error'}. Check the URL, your DNS/firewall, and IdP availability.`,
        steps,
      }
    }
    if (!discoveryRes.ok) {
      return {
        ok: false,
        stage: 'discovery-fetch',
        hint: `Discovery URL returned ${discoveryRes.status}. Check the URL and IdP availability.`,
        steps,
      }
    }
    try {
      discovery = (await discoveryRes.json()) as typeof discovery
    } catch (err) {
      return {
        ok: false,
        stage: 'discovery-fetch',
        hint: `Discovery URL returned non-JSON response: ${err instanceof Error ? err.message : 'parse error'}. Check that the URL points at a valid OIDC discovery document.`,
        steps,
      }
    }
    steps.push({ ok: true, stage: 'discovery-fetch', label: 'Discovery doc fetched' })
  } else if (input.tokenEndpoint && input.jwksUri && input.issuer) {
    discovery = {
      issuer: input.issuer,
      token_endpoint: input.tokenEndpoint,
      jwks_uri: input.jwksUri,
      userinfo_endpoint: input.userinfoEndpoint,
    }
    steps.push({ ok: true, stage: 'discovery-fetch', label: 'Using configured endpoints' })
  } else {
    return {
      ok: false,
      stage: 'discovery-fetch',
      hint: 'Provider has no discovery URL and is missing one or more manual endpoints (token, JWKS, issuer).',
      steps,
    }
  }

  // Mirror production: Better-Auth's genericOAuth plugin runs with
  // pkce: true in our config, so the test flow sends code_verifier
  // too. Diverging here would test a slightly-different protocol and
  // produce false positives.
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code_verifier: input.codeVerifier,
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  })
  let tokenRes: Response
  try {
    tokenRes = await safeFetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: tokenBody.toString(),
      timeoutMs: 10_000,
    })
  } catch (err) {
    if (err instanceof SsrfError) {
      return {
        ok: false,
        stage: 'token-exchange',
        hint: `The IdP's token endpoint (${discovery.token_endpoint}) is not safe to fetch (${err.reason}). The discovery document may be misconfigured or hostile.`,
        steps,
      }
    }
    return {
      ok: false,
      stage: 'token-exchange',
      hint: `Token endpoint could not be reached: ${err instanceof Error ? err.message : 'network error'}.`,
      steps,
    }
  }
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
  let tokens: {
    id_token?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }
  try {
    tokens = (await tokenRes.json()) as typeof tokens
  } catch (err) {
    return {
      ok: false,
      stage: 'token-exchange',
      hint: `Token endpoint returned non-JSON success response: ${err instanceof Error ? err.message : 'parse error'}. The IdP responded 2xx but the body could not be parsed as JSON.`,
      steps,
    }
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

  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(tokens.id_token)
  } catch (err) {
    return {
      ok: false,
      stage: 'id-token-decode',
      hint: `ID token is not a well-formed JWT (cannot decode header): ${err instanceof Error ? err.message : 'decode error'}. The IdP returned an id_token that is not a valid compact JWS.`,
      steps,
    }
  }
  steps.push({
    ok: true,
    stage: 'id-token-decode',
    label: 'ID token decoded',
    detail: `alg=${header.alg ?? '?'} kid=${header.kid ?? '?'}`,
  })

  let verifiedPayload: ReturnType<typeof decodeJwt>
  try {
    // Fetch the JWKS through the pinned fetch rather than letting jose's
    // createRemoteJWKSet do its own unpinned (DNS-rebind-able) fetch,
    // then verify against the resulting local key set.
    const jwksRes = await safeFetch(discovery.jwks_uri, {
      timeoutMs: 5000,
      maxResponseBytes: 256 * 1024,
    })
    if (!jwksRes.ok) {
      return {
        ok: false,
        stage: 'signature-verify',
        hint: `JWKS endpoint returned ${jwksRes.status}. The IdP's jwks_uri must serve the signing key set.`,
        steps,
      }
    }
    const jwks = createLocalJWKSet(
      (await jwksRes.json()) as Parameters<typeof createLocalJWKSet>[0]
    )
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: discovery.issuer,
      audience: input.clientId,
    })
    verifiedPayload = payload
  } catch (err) {
    if (err instanceof SsrfError) {
      return {
        ok: false,
        stage: 'signature-verify',
        hint: `The IdP's JWKS URI (${discovery.jwks_uri}) is not safe to fetch (${err.reason}). The discovery document may be misconfigured or hostile.`,
        steps,
      }
    }
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

  if (!verifiedPayload.sub) {
    return {
      ok: false,
      stage: 'claim-check',
      hint: "ID token missing required 'sub' claim. The IdP must include a stable subject identifier on every ID token (OIDC core requirement).",
      steps,
    }
  }

  // Identity comes from THE resolver — the same one production sign-in uses.
  // Demanding an email inside the ID token here is what made a provider that
  // releases the address at userinfo sign users in successfully while failing
  // the very test that gates enforcement.
  const { resolveIdentity } = await import('./resolve-identity')
  const resolution = await resolveIdentity({
    tokens: { idToken: tokens.id_token, accessToken: tokens.access_token },
    fetchUserInfo: async () => {
      if (!discovery.userinfo_endpoint || !tokens.access_token) return null
      try {
        const uiRes = await safeFetch(discovery.userinfo_endpoint, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          timeoutMs: 5000,
        })
        if (!uiRes.ok) {
          steps.push({
            ok: false,
            stage: 'userinfo',
            label: `Userinfo failed (${uiRes.status})`,
          })
          return null
        }
        steps.push({ ok: true, stage: 'userinfo', label: 'Userinfo endpoint reachable' })
        const body: unknown = await uiRes.json()
        return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null
      } catch {
        steps.push({
          ok: false,
          stage: 'userinfo',
          label: 'Userinfo unreachable or unsafe to fetch',
        })
        return null
      }
    },
  })

  if (!resolution.ok) {
    return {
      ok: false,
      stage: 'claim-check',
      hint:
        resolution.reason === 'subject_mismatch'
          ? "Your IdP's userinfo endpoint reported a different 'sub' than its ID token. OIDC requires these to match, and mixing them could attach the wrong account, so sign-in is refused. This usually means a token or session mix-up at the IdP."
          : "Couldn't resolve an account identifier. The IdP must return a stable 'sub' in the ID token or from its userinfo endpoint.",
      steps,
    }
  }

  const { identity } = resolution
  // Per-field provenance: this is what makes a userinfo-sourced address legible
  // instead of looking like a failure.
  for (const field of ['id', 'email', 'name'] as const) {
    const source = identity.sources[field]
    if (!source) continue
    steps.push({
      ok: true,
      stage: 'claim-check',
      label: `${field === 'id' ? 'Account identifier' : field === 'email' ? 'Email address' : 'Display name'} resolved`,
      detail: source === 'idToken' ? 'from the ID token' : `from ${source}`,
    })
  }

  if (!identity.email) {
    return {
      ok: false,
      stage: 'claim-check',
      hint: "No email address was released, in the ID token or from the userinfo endpoint. Quackback needs one to create the account. Either configure your IdP's claim mapper to release it, or — if this provider has no email addresses to give — enable the placeholder-address option on the provider.",
      steps,
    }
  }

  return {
    ok: true,
    steps,
    claims: {
      iss: verifiedPayload.iss as string,
      sub: verifiedPayload.sub as string,
      aud: verifiedPayload.aud as string | string[],
      email: identity.email,
      email_verified: identity.emailVerified,
      name: identity.name,
      preferred_username: verifiedPayload.preferred_username as string | undefined,
    },
    tokenInfo: {
      idTokenAlg: (header.alg ?? 'unknown') as string,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    },
    allClaims: verifiedPayload as unknown as Record<string, JsonValue>,
  }
}
