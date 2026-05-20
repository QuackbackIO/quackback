/**
 * Tests for the SSO test-callback helper that the auth catch-all route
 * (`/api/auth/oauth2/callback/sso`) calls before handing off to
 * Better-Auth. State-keyed Redis lookup is the discriminator: a hit
 * means "this is an admin Test sign-in, run the diagnostic handshake
 * and render the popup HTML"; a miss means "let Better-Auth handle it
 * as a normal SSO callback."
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  runHandshake: vi.fn(),
  userFindFirst: vi.fn(),
  markSsoTestSucceeded: vi.fn(),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheGet: hoisted.cacheGet,
  cacheSet: hoisted.cacheSet,
  cacheDel: hoisted.cacheDel,
  CACHE_KEYS: {},
}))

vi.mock('@/lib/server/auth/sso-test-handshake', () => ({
  runHandshake: hoisted.runHandshake,
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: (...args: unknown[]) => hoisted.userFindFirst(...args) },
    },
  },
  user: { id: 'user_id_col', email: 'user_email_col' },
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
}))

// The identity-match path stamps `ssoOidc.lastSuccessfulTestAt` via the
// settings service rather than touching `principal` directly.
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  markSsoTestSucceeded: hoisted.markSsoTestSucceeded,
}))

import { handleSsoTestCallback, renderSsoTestCallbackHtml } from '../sso-test-callback'
import { SSO_TEST_POSTMESSAGE_SOURCE } from '@/lib/shared/sso-test-keys'

const validSession = {
  testId: 'ssotest_abc',
  state: 'state-xyz',
  nonce: 'nonce-xyz',
  discoveryUrl: 'https://idp/.well-known',
  tokenEndpoint: 'https://idp/token',
  jwksUri: 'https://idp/jwks',
  authorizationEndpoint: 'https://idp/auth',
  issuer: 'https://idp',
  clientId: 'cid',
  clientSecret: 'csecret',
  redirectUri: 'https://qb.test/api/auth/oauth2/callback/sso',
  adminUserId: 'user_admin',
  startedAt: 1700000000,
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.markSsoTestSucceeded.mockResolvedValue(undefined)
})

describe('handleSsoTestCallback', () => {
  it('returns null when state is absent (caller falls through to Better-Auth)', async () => {
    const result = await handleSsoTestCallback({
      state: null,
      code: 'x',
      error: null,
      errorDescription: null,
    })
    expect(result).toBeNull()
    expect(hoisted.cacheGet).not.toHaveBeenCalled()
  })

  it('returns null when no test session exists for the state', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(null)
    const result = await handleSsoTestCallback({
      state: 'unknown-state',
      code: 'x',
      error: null,
      errorDescription: null,
    })
    expect(result).toBeNull()
    expect(hoisted.cacheGet).toHaveBeenCalledWith('sso-test:unknown-state')
    expect(hoisted.cacheDel).not.toHaveBeenCalled()
    expect(hoisted.runHandshake).not.toHaveBeenCalled()
  })

  it('deletes session before running handshake (replay defense) and persists wire-safe ok result', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(validSession)
    const okResult = {
      ok: true,
      steps: [{ ok: true, stage: 'state-validation', label: 'state' }],
      claims: { iss: 'https://idp', sub: 'u1', aud: 'cid', email: 'a@b' },
      tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
    }
    hoisted.runHandshake.mockResolvedValueOnce(okResult)
    // Admin's stored email does not match the IdP email — identityMatched=false.
    hoisted.userFindFirst.mockResolvedValueOnce({ email: 'different@example.com' })

    const handled = await handleSsoTestCallback({
      state: 'state-xyz',
      code: 'authcode',
      error: null,
      errorDescription: null,
    })

    expect(hoisted.cacheDel).toHaveBeenCalledWith('sso-test:state-xyz')
    expect(hoisted.runHandshake).toHaveBeenCalledTimes(1)
    expect(hoisted.cacheDel.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.runHandshake.mock.invocationCallOrder[0]
    )

    expect(hoisted.runHandshake).toHaveBeenCalledWith({
      state: 'state-xyz',
      code: 'authcode',
      idpError: null,
      idpErrorDescription: null,
      expectedState: 'state-xyz',
      expectedNonce: 'nonce-xyz',
      discoveryUrl: 'https://idp/.well-known',
      clientId: 'cid',
      clientSecret: 'csecret',
      redirectUri: 'https://qb.test/api/auth/oauth2/callback/sso',
    })

    expect(hoisted.cacheSet).toHaveBeenCalledWith(
      'sso-test:result:ssotest_abc',
      { result: okResult, identityMatched: false },
      600
    )

    expect(handled).toEqual({
      testId: 'ssotest_abc',
      result: okResult,
      identityMatched: false,
    })
  })

  it('strips the failure-branch raw debug field before persisting and returning', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(validSession)
    const failResult = {
      ok: false,
      stage: 'token-exchange',
      errorCode: 'invalid_grant',
      hint: 'bad code',
      steps: [{ ok: false, stage: 'token-exchange', label: 'token' }],
      raw: { secret: 'leaky-internal-payload' },
    }
    hoisted.runHandshake.mockResolvedValueOnce(failResult)

    const handled = await handleSsoTestCallback({
      state: 'state-xyz',
      code: 'authcode',
      error: null,
      errorDescription: null,
    })

    expect(handled?.testId).toBe('ssotest_abc')
    expect(handled?.result).toEqual({
      ok: false,
      stage: 'token-exchange',
      errorCode: 'invalid_grant',
      hint: 'bad code',
      steps: failResult.steps,
    })
    expect((handled?.result as Record<string, unknown>).raw).toBeUndefined()

    const [, persisted] = hoisted.cacheSet.mock.calls[0]
    expect((persisted as { result: Record<string, unknown> }).result.raw).toBeUndefined()
  })

  it('matching email stamps lastSuccessfulTestAt and returns identityMatched=true', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(validSession)
    const okResult = {
      ok: true,
      steps: [],
      // Mixed-case + surrounding whitespace on IdP side to exercise the
      // case-insensitive trim normalization.
      claims: { iss: 'https://idp', sub: 'u1', aud: 'cid', email: '  Admin@ACME.com  ' },
      tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
    }
    hoisted.runHandshake.mockResolvedValueOnce(okResult)
    hoisted.userFindFirst.mockResolvedValueOnce({ email: 'admin@acme.com' })

    const handled = await handleSsoTestCallback({
      state: 'state-xyz',
      code: 'authcode',
      error: null,
      errorDescription: null,
    })

    expect(handled?.identityMatched).toBe(true)
    expect(hoisted.markSsoTestSucceeded).toHaveBeenCalledTimes(1)
    expect(hoisted.cacheSet).toHaveBeenCalledWith(
      'sso-test:result:ssotest_abc',
      { result: okResult, identityMatched: true },
      600
    )
  })

  it('mismatching email still stamps lastSuccessfulTestAt but returns identityMatched=false', async () => {
    // A successful handshake proves the connection works regardless of
    // which IdP account signed in — so the stamp lands. identityMatched
    // is reported (false here) purely as informational context.
    hoisted.cacheGet.mockResolvedValueOnce(validSession)
    const okResult = {
      ok: true,
      steps: [],
      claims: { iss: 'https://idp', sub: 'u1', aud: 'cid', email: 'someone-else@acme.com' },
      tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
    }
    hoisted.runHandshake.mockResolvedValueOnce(okResult)
    hoisted.userFindFirst.mockResolvedValueOnce({ email: 'admin@acme.com' })

    const handled = await handleSsoTestCallback({
      state: 'state-xyz',
      code: 'authcode',
      error: null,
      errorDescription: null,
    })

    expect(handled?.identityMatched).toBe(false)
    expect(hoisted.markSsoTestSucceeded).toHaveBeenCalledTimes(1)
    expect(hoisted.cacheSet).toHaveBeenCalledWith(
      'sso-test:result:ssotest_abc',
      { result: okResult, identityMatched: false },
      600
    )
  })

  it('no email claim still stamps but returns identityMatched=false and skips the user lookup', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(validSession)
    const okResult = {
      ok: true,
      steps: [],
      claims: { iss: 'https://idp', sub: 'u1', aud: 'cid' },
      tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
    }
    hoisted.runHandshake.mockResolvedValueOnce(okResult)

    const handled = await handleSsoTestCallback({
      state: 'state-xyz',
      code: 'authcode',
      error: null,
      errorDescription: null,
    })

    expect(handled?.identityMatched).toBe(false)
    expect(hoisted.userFindFirst).not.toHaveBeenCalled()
    expect(hoisted.markSsoTestSucceeded).toHaveBeenCalledTimes(1)
  })

  it('failed handshake does not stamp lastSuccessfulTestAt', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(validSession)
    hoisted.runHandshake.mockResolvedValueOnce({
      ok: false,
      stage: 'token-exchange',
      errorCode: 'invalid_grant',
      hint: 'bad code',
      steps: [],
    })

    const handled = await handleSsoTestCallback({
      state: 'state-xyz',
      code: 'authcode',
      error: null,
      errorDescription: null,
    })

    expect(handled?.identityMatched).toBe(false)
    expect(hoisted.userFindFirst).not.toHaveBeenCalled()
    expect(hoisted.markSsoTestSucceeded).not.toHaveBeenCalled()
  })

  it('forwards IdP-side error params to the handshake', async () => {
    hoisted.cacheGet.mockResolvedValueOnce(validSession)
    hoisted.runHandshake.mockResolvedValueOnce({
      ok: false,
      stage: 'idp-authorize',
      errorCode: 'access_denied',
      hint: 'user declined',
      steps: [],
    })

    await handleSsoTestCallback({
      state: 'state-xyz',
      code: null,
      error: 'access_denied',
      errorDescription: 'User declined consent',
    })

    expect(hoisted.runHandshake).toHaveBeenCalledWith(
      expect.objectContaining({
        idpError: 'access_denied',
        idpErrorDescription: 'User declined consent',
      })
    )
  })
})

describe('renderSsoTestCallbackHtml', () => {
  const okResult = {
    ok: true as const,
    steps: [],
    claims: { iss: 'https://idp', sub: 'u1', aud: 'cid' },
    tokenInfo: { idTokenAlg: 'RS256', hasAccessToken: true, hasRefreshToken: false },
  }

  it('returns a 200 HTML response', async () => {
    const res = renderSsoTestCallbackHtml({
      testId: 'ssotest_abc',
      result: okResult,
      origin: 'https://qb.test',
      identityMatched: false,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
  })

  it('embeds the postMessage source tag and the testId so the opener can correlate', async () => {
    const res = renderSsoTestCallbackHtml({
      testId: 'ssotest_abc',
      result: okResult,
      origin: 'https://qb.test',
      identityMatched: false,
    })
    const html = await res.text()
    expect(html).toContain(SSO_TEST_POSTMESSAGE_SOURCE)
    expect(html).toContain('ssotest_abc')
    // postMessage must target the opener's exact origin, not "*"
    expect(html).toContain('https://qb.test')
  })

  it('escapes payload contents to prevent script injection via IdP-controlled fields', async () => {
    const evil = {
      ok: false as const,
      stage: 'token-exchange' as const,
      errorCode: 'evil',
      hint: '</script><img src=x onerror="alert(1)">',
      steps: [],
    }
    const res = renderSsoTestCallbackHtml({
      testId: 'ssotest_abc',
      result: evil,
      origin: 'https://qb.test',
      identityMatched: false,
    })
    const html = await res.text()
    // The literal `</script>` from the hint must not survive into the
    // rendered HTML — otherwise a malicious IdP error_description could
    // break out of our inline JSON-in-script payload.
    expect(html).not.toMatch(/<\/script>\s*<img/i)
  })
})
