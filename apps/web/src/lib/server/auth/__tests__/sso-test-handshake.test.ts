import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runHandshake, type HandshakeInput } from '../sso-test-handshake'

// `checkUrlSafety` does live DNS resolution; in tests we use fake hostnames
// (idp / idp.example) that won't resolve. Mock it to always return safe so
// we can exercise the handshake's discovery + token-exchange branches.
vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: vi.fn(async () => ({ safe: true, address: '203.0.113.1', family: 4 })),
}))

const baseInput: HandshakeInput = {
  state: 'state123',
  code: 'authcode456',
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
  clientId: 'cid',
  clientSecret: 'csecret',
  redirectUri: 'https://qb/admin/sso/test/callback',
  expectedNonce: 'nonce789',
  expectedState: 'state123',
}

beforeEach(() => vi.restoreAllMocks())

describe('runHandshake', () => {
  it('rejects on state mismatch before any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await runHandshake({ ...baseInput, state: 'wrong' })
    if (result.ok) throw new Error('expected failure')
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('state-validation')
    expect(fetchSpy).not.toHaveBeenCalled()
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

  it('surfaces token-exchange error with human hint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          issuer: 'https://idp',
          token_endpoint: 'https://idp/token',
          jwks_uri: 'https://idp/jwks',
        }),
        { status: 200 }
      )
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
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
