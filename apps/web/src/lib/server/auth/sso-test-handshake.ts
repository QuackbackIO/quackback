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
  /** The scopes this attempt actually requested. */
  requestedScopes?: readonly string[]
  /** How to authenticate at the token endpoint. Mirrors production. */
  tokenAuth?: 'basic' | 'post'
  /** The `prompt` this attempt sent, so a configuration error can name it. */
  requestedPrompt?: string
  /**
   * Whether this provider is configured to mint a placeholder address when the
   * IdP releases none. The test has to know, because sign-in does.
   */
  allowMissingEmail?: boolean
  /** Identity sources and claim paths — the same mapping production uses. */
  identityMapping?: import('./resolve-identity').IdentityMapping
  /** IdP-returned `error` query parameter, if the authorize step failed. */
  idpError?: string | null
  idpErrorDescription?: string | null
}

export interface DiagnosticStep {
  ok: boolean
  stage: HandshakeStage
  label: string
  detail?: string
  /**
   * `'info'` renders muted — neither a pass nor a fail. For optional signals
   * (the avatar) that report what the IdP released without gating the
   * connection. Absent → the row's icon follows `ok`.
   */
  severity?: 'info'
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
      /** Merged claims the resolver saw (earlier source wins). Lets admins
       *  see non-standard claims (groups, roles, ...) when debugging
       *  claim-to-role mapping. The curated `claims` above is for the friendly
       *  display + identity match; this is the complete set. */
      allClaims?: Record<string, JsonValue>
      /** Resolved identity + per-field provenance. Feeds the editor's
       *  session-scoped outcome preview. */
      identity?: {
        id: string
        email?: string
        name?: string
        image?: string
        sources: Partial<Record<'id' | 'email' | 'name' | 'image', string>>
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
      hint: explainAuthorizeError(
        input.idpError,
        input.idpErrorDescription,
        input.requestedScopes,
        input.requestedPrompt
      ),
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
  } else if (input.tokenEndpoint) {
    discovery = {
      issuer: input.issuer ?? '',
      token_endpoint: input.tokenEndpoint,
      jwks_uri: input.jwksUri ?? '',
      // Row userInfoUrl wins over discovery; callers already apply that
      // precedence when they populate userinfoEndpoint.
      userinfo_endpoint: input.userinfoEndpoint,
    }
    steps.push({ ok: true, stage: 'discovery-fetch', label: 'Using configured endpoints' })
  } else {
    return {
      ok: false,
      stage: 'discovery-fetch',
      hint: 'Provider has no discovery URL and is missing a token endpoint.',
      steps,
    }
  }

  // Row userInfoUrl takes precedence over the discovery document, matching
  // production registration.
  if (input.userinfoEndpoint) {
    discovery.userinfo_endpoint = input.userinfoEndpoint
  }

  // Mirror production: Better-Auth's genericOAuth plugin runs with
  // pkce: true in our config, so the test flow sends code_verifier
  // too. Diverging here would test a slightly-different protocol and
  // produce false positives.
  const useBasic = input.tokenAuth === 'basic'
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code_verifier: input.codeVerifier,
    code: input.code,
    redirect_uri: input.redirectUri,
    ...(useBasic ? {} : { client_id: input.clientId, client_secret: input.clientSecret }),
  })
  const basicHeader: Record<string, string> = useBasic
    ? {
        Authorization: `Basic ${Buffer.from(
          `${encodeURIComponent(input.clientId)}:${encodeURIComponent(input.clientSecret)}`
        ).toString('base64')}`,
      }
    : {}
  let tokenRes: Response
  try {
    tokenRes = await safeFetch(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...basicHeader,
      },
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
  steps.push({ ok: true, stage: 'token-exchange', label: 'Token exchange succeeded' })

  const sources = input.identityMapping?.sources
  const accessTokenOnly =
    Array.isArray(sources) && sources.includes('accessTokenJwt') && !sources.includes('idToken')
  const hasIdToken = typeof tokens.id_token === 'string' && tokens.id_token.length > 0

  if (!hasIdToken && !accessTokenOnly) {
    return {
      ok: false,
      stage: 'token-exchange',
      hint: "No id_token returned. Make sure 'openid' is in the requested scopes and your IdP is configured to issue ID tokens, or set identity sources to access-token JWT only.",
      steps,
    }
  }

  let header: ReturnType<typeof decodeProtectedHeader> | undefined
  let verifiedPayload: ReturnType<typeof decodeJwt> | undefined

  if (hasIdToken) {
    try {
      header = decodeProtectedHeader(tokens.id_token!)
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

    if (!discovery.jwks_uri || !discovery.issuer) {
      return {
        ok: false,
        stage: 'signature-verify',
        hint: 'An ID token was returned but this provider has no JWKS URI / issuer to verify it against.',
        steps,
      }
    }

    try {
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
      const { payload } = await jwtVerify(tokens.id_token!, jwks, {
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
  }

  const { resolveIdentity } = await import('./resolve-identity')
  const resolution = await resolveIdentity({
    tokens: { idToken: tokens.id_token, accessToken: tokens.access_token },
    mapping: input.identityMapping,
    // Mirror production, which now resolves the avatar from `picture`.
    wantImage: true,
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
          ? "Your IdP's userinfo endpoint reported a different 'sub' than its ID token. OIDC requires these to match, and mixing them could attach the wrong account, so sign-in is refused."
          : "Couldn't resolve an account identifier. The IdP must return a stable subject in the ID token, userinfo, or (when configured) the access token.",
      steps,
    }
  }

  const { identity } = resolution
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

  // Avatar is optional: report it, but a missing `picture` is informational,
  // not a failed connection.
  if (identity.image) {
    steps.push({
      ok: true,
      stage: 'claim-check',
      label: 'Avatar resolved',
      detail:
        identity.sources.image === 'idToken'
          ? 'from the ID token'
          : `from ${identity.sources.image}`,
    })
  } else {
    steps.push({
      ok: true,
      severity: 'info',
      stage: 'claim-check',
      label: 'No avatar released',
      detail:
        'The IdP returned no `picture` claim (in the ID token or userinfo). Sign-in works without one; add it to your IdP’s claim/scope mapping to give users an avatar.',
    })
  }

  // Observed, not enforced. Surfacing it here is how an admin learns about the
  // discrepancy while sign-in still works, rather than discovering it on the
  // release that starts refusing.
  if (identity.warnings?.includes('subject_mismatch')) {
    steps.push({
      ok: false,
      stage: 'claim-check',
      label: 'Subject mismatch between ID token and userinfo',
      detail:
        'OIDC requires these to agree. Sign-in still works today, but a future release will refuse it — raise this with your IdP.',
    })
  }

  if (!identity.email) {
    if (!input.allowMissingEmail) {
      return {
        ok: false,
        stage: 'claim-check',
        hint: "No email address was released, in the ID token or from the userinfo endpoint. Either configure your IdP's claim mapper to release it, or — if this provider has no email addresses to give — enable the placeholder-address option on the provider.",
        steps,
      }
    }
    steps.push({
      ok: true,
      stage: 'claim-check',
      label: 'No email released — a placeholder address will be created',
    })
  }

  const accessPayload =
    !verifiedPayload && tokens.access_token ? decodeJwtSafe(tokens.access_token) : null

  return {
    ok: true,
    steps,
    claims: {
      iss:
        (verifiedPayload?.iss as string | undefined) ??
        (accessPayload?.iss as string | undefined) ??
        '',
      sub: identity.id,
      aud:
        (verifiedPayload?.aud as string | string[] | undefined) ??
        (accessPayload?.aud as string | string[] | undefined) ??
        input.clientId,
      email: identity.email,
      email_verified: identity.emailVerified,
      name: identity.name,
      preferred_username: verifiedPayload?.preferred_username as string | undefined,
    },
    tokenInfo: {
      idTokenAlg: (header?.alg ?? (hasIdToken ? 'unknown' : 'none')) as string,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    },
    allClaims: identity.claims as unknown as Record<string, JsonValue>,
    identity: {
      id: identity.id,
      email: identity.email,
      name: identity.name,
      image: identity.image,
      sources: identity.sources,
    },
  }
}

function decodeJwtSafe(token: string): Record<string, unknown> | null {
  try {
    const payload = decodeJwt(token)
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}
