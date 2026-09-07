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
import {
  DEFAULT_IDENTITY_SOURCES,
  claimMappingFor,
  type IdentityProviderClaimMapping,
  type IdentitySource,
  type SourceUnavailableReason,
} from '@/lib/shared/oidc-claim-mapping'
import {
  finishBinding,
  replayClaimMapping,
  type IdentityMapping,
} from '@/lib/shared/sso-claim-binder'
import { finalizeProfileOutcome, type ProfileOutcome } from '@/lib/shared/sso-profile-outcome'
import type {
  CapturedIdentity,
  SourceSnapshot,
  SsoTestCaptureV2,
} from '@/lib/shared/sso-test-capture'

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
  identityMapping?: IdentityMapping
  /**
   * Full stored mapping snapshotted at test start. Pre-deploy sessions may omit
   * this and carry only `identityMapping` for the existing 600-second TTL.
   */
  claimMapping?: IdentityProviderClaimMapping
  registrationId?: string
  detailsChangedAtAtStart?: string | null
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
      mappingOutcome?: ProfileOutcome
      capture?: SsoTestCaptureV2
    }
  | {
      ok: false
      stage: HandshakeStage
      errorCode?: string
      hint: string
      raw?: unknown
      steps: DiagnosticStep[]
      mappingOutcome?: ProfileOutcome
      capture?: SsoTestCaptureV2
      allClaims?: Record<string, JsonValue>
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

  const hasIdToken = typeof tokens.id_token === 'string' && tokens.id_token.length > 0

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

  const identityMapping = input.identityMapping
  const storedMapping = claimMappingFor(input.claimMapping)
  const requiredClaimPaths = [
    ...(storedMapping.attributes?.map ?? []).map((entry) => entry.claimPath),
    ...(storedMapping.role?.claimPath ? [storedMapping.role.claimPath] : []),
  ]
  const configuredSources = identityMapping?.sources ?? DEFAULT_IDENTITY_SOURCES

  let userinfoMemo:
    { claims: Record<string, unknown> } | { unavailable: SourceUnavailableReason } | undefined
  const loadUserinfo = async (): Promise<
    { claims: Record<string, unknown> } | { unavailable: SourceUnavailableReason }
  > => {
    if (userinfoMemo) return userinfoMemo
    if (!discovery.userinfo_endpoint || !tokens.access_token) {
      userinfoMemo = { unavailable: 'absent' }
      return userinfoMemo
    }
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
        userinfoMemo = { unavailable: 'fetch_failed' }
        return userinfoMemo
      }
      steps.push({ ok: true, stage: 'userinfo', label: 'Userinfo endpoint reachable' })
      const body: unknown = await uiRes.json()
      userinfoMemo =
        body !== null && typeof body === 'object' && !Array.isArray(body)
          ? { claims: body as Record<string, unknown> }
          : { unavailable: 'absent' }
      return userinfoMemo
    } catch {
      steps.push({
        ok: false,
        stage: 'userinfo',
        label: 'Userinfo unreachable or unsafe to fetch',
      })
      userinfoMemo = { unavailable: 'fetch_failed' }
      return userinfoMemo
    }
  }

  const snapshots: SourceSnapshot[] = []
  for (const source of configuredSources) {
    snapshots.push(
      await snapshotForSource(source, { hasIdToken, verifiedPayload, tokens, loadUserinfo })
    )
  }

  const bound = finishBinding(
    replayClaimMapping(
      {
        mapping: identityMapping,
        requiredClaimPaths: requiredClaimPaths.length > 0 ? requiredClaimPaths : undefined,
        wantImage: true,
      },
      snapshots
    )
  )
  const mappingOutcome = finalizeProfileOutcome(bound, {
    allowMissingEmail: input.allowMissingEmail === true,
  })
  const diagnosticClaims = mergeSnapshotClaims(snapshots)
  const capture = buildTestCapture({
    registrationId: input.registrationId ?? '',
    detailsChangedAtAtStart: input.detailsChangedAtAtStart ?? null,
    snapshots,
    bound,
    mappingOutcome,
  })

  if (bound.failed === 'subject_mismatch') {
    return {
      ok: false,
      stage: 'claim-check',
      hint: "Your IdP's userinfo endpoint reported a different 'sub' than its ID token. OIDC requires these to match, and mixing them could attach the wrong account, so sign-in is refused.",
      steps,
      mappingOutcome,
      capture,
      allClaims: diagnosticClaims as Record<string, JsonValue>,
    }
  }

  if (mappingOutcome.kind === 'missing_id') {
    return {
      ok: false,
      stage: 'claim-check',
      hint: "Couldn't resolve an account identifier. The IdP must return a stable subject in the ID token, userinfo, or (when configured) the access token.",
      steps,
      mappingOutcome,
      capture,
      allClaims: diagnosticClaims as Record<string, JsonValue>,
    }
  }

  const identity = capture.identity

  for (const field of ['id', 'email', 'name'] as const) {
    const source = bound.provenance[field]?.source
    if (!source) continue
    steps.push({
      ok: true,
      stage: 'claim-check',
      label: `${field === 'id' ? 'Account identifier' : field === 'email' ? 'Email address' : 'Display name'} resolved`,
      detail: source === 'idToken' ? 'from the ID token' : `from ${source}`,
    })
  }

  if (bound.identity.image) {
    steps.push({
      ok: true,
      stage: 'claim-check',
      label: 'Avatar resolved',
      detail:
        bound.provenance.image?.source === 'idToken'
          ? 'from the ID token'
          : `from ${bound.provenance.image?.source}`,
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

  if (bound.warnings.includes('subject_mismatch')) {
    steps.push({
      ok: false,
      stage: 'claim-check',
      label: 'Subject mismatch between ID token and userinfo',
      detail:
        'OIDC requires these to agree. Sign-in still works today, but a future release will refuse it — raise this with your IdP.',
    })
  }

  if (mappingOutcome.kind === 'missing_email') {
    return {
      ok: false,
      stage: 'claim-check',
      hint: "No email address was released, in the ID token or from the userinfo endpoint. Either configure your IdP's claim mapper to release it, or — if this provider has no email addresses to give — enable the placeholder-address option on the provider.",
      steps,
      mappingOutcome,
      capture,
      allClaims: diagnosticClaims as Record<string, JsonValue>,
    }
  }

  if (mappingOutcome.kind === 'placeholder_required') {
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
      sub: bound.identity.id ?? '',
      aud:
        (verifiedPayload?.aud as string | string[] | undefined) ??
        (accessPayload?.aud as string | string[] | undefined) ??
        input.clientId,
      email: bound.identity.email,
      email_verified: bound.identity.emailVerified,
      name: mappingOutcome.name,
      preferred_username: verifiedPayload?.preferred_username as string | undefined,
    },
    tokenInfo: {
      idTokenAlg: (header?.alg ?? (hasIdToken ? 'unknown' : 'none')) as string,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    },
    allClaims: diagnosticClaims as Record<string, JsonValue>,
    identity: identity
      ? {
          id: identity.id,
          email: identity.email,
          name: identity.name,
          image: identity.image,
          sources: identity.sources,
        }
      : undefined,
    mappingOutcome,
    capture,
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

function jsonClaims(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>
}

async function snapshotForSource(
  source: IdentitySource,
  ctx: {
    hasIdToken: boolean
    verifiedPayload: ReturnType<typeof decodeJwt> | undefined
    tokens: { id_token?: string; access_token?: string }
    loadUserinfo: () => Promise<
      { claims: Record<string, unknown> } | { unavailable: SourceUnavailableReason }
    >
  }
): Promise<SourceSnapshot> {
  if (source === 'idToken') {
    if (!ctx.hasIdToken) return { source, unavailable: 'absent' }
    if (!ctx.verifiedPayload) return { source, unavailable: 'unreadable' }
    return { source, claims: jsonClaims(ctx.verifiedPayload as Record<string, unknown>) }
  }
  if (source === 'accessTokenJwt') {
    if (!ctx.tokens.access_token) return { source, unavailable: 'absent' }
    const decoded = decodeJwtSafe(ctx.tokens.access_token)
    if (!decoded) return { source, unavailable: 'unreadable' }
    return { source, claims: jsonClaims(decoded) }
  }
  const loaded = await ctx.loadUserinfo()
  if ('unavailable' in loaded) return { source, unavailable: loaded.unavailable }
  return { source, claims: jsonClaims(loaded.claims) }
}

function mergeSnapshotClaims(snapshots: SourceSnapshot[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const snapshot of snapshots) {
    if (!('claims' in snapshot) || !snapshot.claims) continue
    for (const [key, value] of Object.entries(snapshot.claims)) {
      if (!Object.hasOwn(merged, key)) merged[key] = value
    }
  }
  return merged
}

function buildTestCapture({
  registrationId,
  detailsChangedAtAtStart,
  snapshots,
  bound,
  mappingOutcome,
}: {
  registrationId: string
  detailsChangedAtAtStart: string | null
  snapshots: SourceSnapshot[]
  bound: ReturnType<typeof finishBinding>
  mappingOutcome: ProfileOutcome
}): SsoTestCaptureV2 {
  const success =
    mappingOutcome.kind === 'identity' || mappingOutcome.kind === 'placeholder_required'
  const id = bound.identity.id
  const identity: CapturedIdentity | undefined = id
    ? {
        id,
        ...(mappingOutcome.email ? { email: mappingOutcome.email } : {}),
        ...(mappingOutcome.name ? { name: mappingOutcome.name } : {}),
        ...(bound.identity.image ? { image: bound.identity.image } : {}),
        sources: {
          ...(bound.provenance.id ? { id: bound.provenance.id.source } : {}),
          ...(bound.provenance.email ? { email: bound.provenance.email.source } : {}),
          ...(bound.provenance.name ? { name: bound.provenance.name.source } : {}),
          ...(bound.provenance.image ? { image: bound.provenance.image.source } : {}),
        },
        paths: {
          ...(bound.provenance.id ? { id: bound.provenance.id.path } : {}),
          ...(bound.provenance.email ? { email: bound.provenance.email.path } : {}),
          ...(bound.provenance.name ? { name: bound.provenance.name.path } : {}),
          ...(bound.provenance.image ? { image: bound.provenance.image.path } : {}),
        },
      }
    : undefined
  return {
    version: 2,
    registrationId,
    capturedAt: new Date().toISOString(),
    detailsChangedAtAtStart,
    outcome: success && !bound.failed ? 'success' : 'mapping_failed',
    ...(identity ? { identity } : {}),
    claims: bound.acceptedClaims as Record<string, JsonValue>,
    replay: { sources: snapshots },
  }
}
