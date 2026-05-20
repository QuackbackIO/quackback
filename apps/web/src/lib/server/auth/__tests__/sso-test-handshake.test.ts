import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  expectedNonce: 'nonce789',
  expectedState: 'state123',
}

beforeEach(() => {
  safeFetchMock.mockReset()
})

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
})
