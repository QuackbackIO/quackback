import { describe, it, expect } from 'vitest'
import {
  detectAuthBlockRedirect,
  AuthBlockedError,
  AUTH_BLOCK_MESSAGES,
  type AuthBlockCode,
} from '../redirect-errors'

describe('detectAuthBlockRedirect', () => {
  it('returns null for a non-redirected response', () => {
    expect(
      detectAuthBlockRedirect({
        redirected: false,
        url: 'https://t.example/api/auth/sign-in/email',
      })
    ).toBeNull()
  })

  it('returns null when the redirect lands somewhere other than the login pages', () => {
    expect(
      detectAuthBlockRedirect({ redirected: true, url: 'https://t.example/dashboard' })
    ).toBeNull()
  })

  it('returns null when the login page carries no error param (a normal redirect)', () => {
    expect(
      detectAuthBlockRedirect({ redirected: true, url: 'https://t.example/admin/login' })
    ).toBeNull()
  })

  it('translates password_method_not_allowed into a magic-link/SSO hint', () => {
    const err = detectAuthBlockRedirect({
      redirected: true,
      url: 'https://t.example/admin/login?error=password_method_not_allowed',
    })
    expect(err).toBeInstanceOf(AuthBlockedError)
    expect(err?.code).toBe('password_method_not_allowed')
    expect(err?.message).toMatch(/Password sign-in isn't enabled/i)
  })

  it('also fires for the portal login path', () => {
    const err = detectAuthBlockRedirect({
      redirected: true,
      url: 'https://t.example/auth/login?error=rate_limited',
    })
    expect(err?.code).toBe('rate_limited')
    expect(err?.message).toMatch(/too many sign-in attempts/i)
  })

  it('falls back to a generic message for an unknown error code', () => {
    const err = detectAuthBlockRedirect({
      redirected: true,
      url: 'https://t.example/admin/login?error=brand_new_invented_code',
    })
    expect(err?.code).toBe('brand_new_invented_code')
    expect(err?.message).toMatch(/sign-in isn't allowed right now/i)
  })

  it('tolerates a malformed url instead of throwing', () => {
    expect(detectAuthBlockRedirect({ redirected: true, url: 'not-a-url' })).toBeNull()
  })
})

describe('AUTH_BLOCK_MESSAGES', () => {
  it('covers the migrated admin-only codes', () => {
    for (const code of ['token_expired', 'signup_disabled', 'OAUTH_CALLBACK_ERROR', 'not_team_member'] as AuthBlockCode[]) {
      expect(AUTH_BLOCK_MESSAGES[code]).toBeTruthy()
    }
  })
})
