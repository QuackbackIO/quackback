// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { stashSsoAttempt, takeSsoAttempt } from '../sso-attempt-stash'

describe('sso-attempt-stash', () => {
  beforeEach(() => sessionStorage.clear())

  it('round-trips an attempt and clears it on take', () => {
    stashSsoAttempt({
      providerId: 'custom-oidc',
      providerType: 'oidc',
      email: 'jane@acme.com',
      callbackUrl: '/board/ideas',
    })
    const attempt = takeSsoAttempt()
    expect(attempt).toMatchObject({
      providerId: 'custom-oidc',
      providerType: 'oidc',
      email: 'jane@acme.com',
      callbackUrl: '/board/ideas',
    })
    // Read-and-clear: a second take returns nothing.
    expect(takeSsoAttempt()).toBeNull()
  })

  it('returns null for malformed or foreign payloads', () => {
    sessionStorage.setItem('qb-sso-attempt', 'not json')
    expect(takeSsoAttempt()).toBeNull()
    sessionStorage.setItem('qb-sso-attempt', JSON.stringify({ providerId: 42, ts: Date.now() }))
    expect(takeSsoAttempt()).toBeNull()
  })

  it('expires attempts older than the recovery window', () => {
    sessionStorage.setItem(
      'qb-sso-attempt',
      JSON.stringify({
        providerId: 'sso',
        providerType: 'oidc',
        ts: Date.now() - 16 * 60 * 1000,
      })
    )
    expect(takeSsoAttempt()).toBeNull()
  })

  it('returns null when nothing was stashed', () => {
    expect(takeSsoAttempt()).toBeNull()
  })
})
