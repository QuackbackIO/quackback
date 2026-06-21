import { describe, it, expect } from 'vitest'
import { authLoginRedirectTarget } from '../auth.login'

describe('authLoginRedirectTarget', () => {
  it('redirects to the portal dialog carrying a safe callbackUrl + error', () => {
    expect(authLoginRedirectTarget({ callbackUrl: '/admin', error: 'token_expired' })).toEqual({
      to: '/',
      search: { signin: '1', callbackUrl: '/admin', error: 'token_expired' },
    })
  })
  it('defaults an unsafe/missing callbackUrl to /', () => {
    expect(authLoginRedirectTarget({})).toEqual({ to: '/', search: { signin: '1', callbackUrl: '/' } })
  })
})
