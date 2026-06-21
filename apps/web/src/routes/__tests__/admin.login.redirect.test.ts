import { describe, it, expect } from 'vitest'
import { adminLoginRedirectTarget } from '../admin.login'

describe('admin.login redirect', () => {
  it('defaults callbackUrl to /admin and preserves error', () => {
    expect(adminLoginRedirectTarget({ callbackUrl: undefined, error: 'token_expired' }))
      .toEqual({ to: '/', search: { signin: '1', callbackUrl: '/admin', error: 'token_expired' } })
  })
  it('keeps a safe team callbackUrl', () => {
    expect(adminLoginRedirectTarget({ callbackUrl: '/admin/settings', error: undefined }))
      .toEqual({ to: '/', search: { signin: '1', callbackUrl: '/admin/settings' } })
  })
  it('rejects unsafe callbackUrl, falls back to /admin', () => {
    expect(adminLoginRedirectTarget({ callbackUrl: 'https://evil.test', error: undefined }))
      .toEqual({ to: '/', search: { signin: '1', callbackUrl: '/admin' } })
  })
})
