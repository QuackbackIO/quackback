import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { runHandshake, type HandshakeInput } from '../sso-test-handshake'

// runHandshake fetches discovery / token / JWKS / userinfo through
// `safeFetch`. Mock only `safeFetch` and keep the rest of the
// ssrf-guard module real — notably `SsrfError`, so the `instanceof`
// branches inside the handshake resolve against the real class.
vi.mock('@/lib/server/content/ssrf-guard', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/content/ssrf-guard')>()
  return { ...actual, safeFetch: vi.fn() }
})

import { safeFetch, SsrfError } from '@/lib/server/content/ssrf-guard'
const safeFetchMock = vi.mocked(safeFetch)

const baseInput: HandshakeInput = {
  state: 'state123',
  code: 'authcode456',
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
  clientId: 'cid',
  clientSecret: 'csecret',
  redirectUri: 'https://qb/api/auth/oauth2/callback/sso',
  codeVerifier: 'test-code-verifier',
  expectedNonce: 'nonce789',
  expectedState: 'state123',
}

beforeEach(() => {
  safeFetchMock.mockReset()
})

/**
 * A World C exchange: the IdP signs an ID token carrying only a subject, and
 * userinfo adds nothing either. Doorkeeper behaves exactly this way when the
 * client is granted `openid` alone, because every other claim is scope-gated.
 */
async function runWorldCHandshake(opts: { allowMissingEmail: boolean }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  publicJwk.kid = 'test-key'
  publicJwk.alg = 'RS256'

  const issuer = 'https://idp.example'
  const idToken = await new SignJWT({ nonce: 'nonce789' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience('cid')
    .setSubject('user-sub-123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

  // discovery, token, JWKS, then userinfo — which also has no address to give.
  safeFetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        issuer,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
      }),
      { status: 200 }
    )
  )
  safeFetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ id_token: idToken, access_token: 'at', token_type: 'Bearer' }), {
      status: 200,
    })
  )
  safeFetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
  )
  safeFetchMock.mockResolvedValue(
    new Response(JSON.stringify({ sub: 'user-sub-123' }), { status: 200 })
  )

  return runHandshake({ ...baseInput, allowMissingEmail: opts.allowMissingEmail })
}

describe('runHandshake', () => {
  it('rejects on state mismatch before any network call', async () => {
    const result = await runHandshake({ ...baseInput, state: 'wrong' })
    if (result.ok) throw new Error('expected failure')
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('state-validation')
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it('surfaces IdP error codes from authorize step', async () => {
    const result = await runHandshake({
      ...baseInput,
      code: null,
      idpError: 'access_denied',
      idpErrorDescription: 'User declined',
    })
    if (result.ok) throw new Error('expected failure')
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('idp-authorize')
    expect(result.errorCode).toBe('access_denied')
  })

  it('rejects when the discoveryUrl fails the SSRF check', async () => {
    // safeFetch validates the URL and throws SsrfError before dialling.
    safeFetchMock.mockRejectedValueOnce(new SsrfError('ssrf-rejected'))

    const result = await runHandshake(baseInput)

    if (result.ok) throw new Error('expected failure')
    expect(result.stage).toBe('discovery-fetch')
    expect(result.hint).toMatch(/not safe to fetch/i)
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a structured discovery-fetch failure when the fetch throws', async () => {
    safeFetchMock.mockRejectedValueOnce(new TypeError('fetch failed: ECONNRESET'))

    const result = await runHandshake(baseInput)

    if (result.ok) throw new Error('expected failure')
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('discovery-fetch')
    expect(result.hint).toMatch(/ECONNRESET|fetch failed|could not be reached/i)
  })

  it('surfaces token-exchange error with human hint', async () => {
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          issuer: 'https://idp',
          token_endpoint: 'https://idp/token',
          jwks_uri: 'https://idp/jwks',
        }),
        { status: 200 }
      )
    )
    safeFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Code expired' }), {
        status: 400,
      })
    )
    const result = await runHandshake(baseInput)
    if (result.ok) throw new Error('expected failure')
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('token-exchange')
    expect(result.errorCode).toBe('invalid_grant')
    expect(result.hint).toMatch(/PKCE|code reuse|expired|redirect URI/i)
  })

  it('surfaces the full ID token payload (allClaims) on success, including non-standard claims', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    publicJwk.kid = 'test-key'
    publicJwk.alg = 'RS256'

    const issuer = 'https://idp.example'
    const idToken = await new SignJWT({
      email: 'alice@idp.example',
      name: 'Alice Example',
      nonce: 'nonce789',
      // The non-standard claim the curated `claims` view drops but admins need.
      groups: ['11111111-2222-3333-4444-555555555555', 'feedback-admins'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience('cid')
      .setSubject('user-sub-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    // Fetch order: 1) discovery  2) token  3) JWKS.
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ issuer, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }),
        { status: 200 }
      )
    )
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id_token: idToken,
          access_token: 'at',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200 }
      )
    )
    safeFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    )

    const result = await runHandshake(baseInput)
    if (!result.ok) throw new Error(`expected success, got ${result.stage}: ${result.hint}`)

    // The curated subset still works for the friendly display + identity match.
    expect(result.claims.email).toBe('alice@idp.example')
    // ...and the full payload is surfaced verbatim, including `groups`.
    expect(result.allClaims).toBeDefined()
    expect(result.allClaims?.groups).toEqual([
      '11111111-2222-3333-4444-555555555555',
      'feedback-admins',
    ])
    expect(result.allClaims?.iss).toBe(issuer)
    expect(result.allClaims?.sub).toBe('user-sub-123')
    expect(result.identity).toEqual({
      id: 'user-sub-123',
      email: 'alice@idp.example',
      name: 'Alice Example',
      sources: { id: 'idToken', email: 'idToken', name: 'idToken' },
    })
  })
})

describe('runHandshake — provider that releases no email', () => {
  it('fails when the placeholder option is off, naming both remedies', async () => {
    const result = await runWorldCHandshake({ allowMissingEmail: false })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('claim-check')
    expect(result.hint).toMatch(/no email address was released/i)
  })

  it('passes when the placeholder option is on, because sign-in would succeed', async () => {
    const result = await runWorldCHandshake({ allowMissingEmail: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims.email).toBeUndefined()
    expect(result.steps.some((s) => /placeholder/i.test(s.label ?? ''))).toBe(true)
  })
})

describe('runHandshake — default sources still require an id_token', () => {
  it('fails when there is only an access_token and identity still reads the ID token', async () => {
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          issuer: 'https://idp.example',
          token_endpoint: 'https://idp.example/token',
          jwks_uri: 'https://idp.example/jwks',
        }),
        { status: 200 }
      )
    )
    safeFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'opaque', token_type: 'Bearer' }), {
        status: 200,
      })
    )

    const result = await runHandshake({ ...baseInput })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('token-exchange')
    expect(result.hint).toMatch(/id_token/i)
  })
})

describe('runHandshake — access-token-only IdP', () => {
  const accessTokenJwt = (payload: Record<string, unknown>) => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`
  }

  it('passes without an id_token when identity is mapped from the access token', async () => {
    const accessToken = accessTokenJwt({
      CharacterID: 42,
      CharacterName: 'Pilot',
      email: 'pilot@idp.example',
    })
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          issuer: 'https://idp.example',
          token_endpoint: 'https://idp.example/token',
          jwks_uri: 'https://idp.example/jwks',
        }),
        { status: 200 }
      )
    )
    safeFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: accessToken, token_type: 'Bearer' }), {
        status: 200,
      })
    )

    const result = await runHandshake({
      ...baseInput,
      identityMapping: {
        sources: ['accessTokenJwt'],
        idClaim: 'CharacterID',
        nameClaim: 'CharacterName',
      },
    })
    if (!result.ok) throw new Error(`expected success, got ${result.stage}: ${result.hint}`)
    expect(result.claims.sub).toBe('42')
    expect(result.claims.name).toBe('Pilot')
    expect(result.claims.email).toBe('pilot@idp.example')
    expect(safeFetchMock.mock.calls.some((c) => String(c[0]).includes('/jwks'))).toBe(false)
  })

  it('still JWKS-verifies an id_token when one is present', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
    const publicJwk = await exportJWK(publicKey)
    publicJwk.kid = 'test-key'
    publicJwk.alg = 'RS256'
    const issuer = 'https://idp.example'
    const idToken = await new SignJWT({
      email: 'alice@idp.example',
      nonce: 'nonce789',
      CharacterID: 7,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience('cid')
      .setSubject('user-sub-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ issuer, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }),
        { status: 200 }
      )
    )
    safeFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id_token: idToken,
          access_token: accessTokenJwt({ CharacterID: 7, email: 'alice@idp.example' }),
          token_type: 'Bearer',
        }),
        { status: 200 }
      )
    )
    safeFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    )

    const result = await runHandshake({
      ...baseInput,
      identityMapping: { sources: ['accessTokenJwt'], idClaim: 'CharacterID' },
    })
    if (!result.ok) throw new Error(`expected success, got ${result.stage}: ${result.hint}`)
    expect(safeFetchMock.mock.calls.some((c) => String(c[0]).includes('/jwks'))).toBe(true)
    expect(result.tokenInfo.idTokenAlg).toBe('RS256')
  })
})
