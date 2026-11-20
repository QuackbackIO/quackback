import { describe, expect, it } from 'vitest'
import { hasSessionCookie, readSessionCookie, sessionCookieNames } from '../auth-cookies'

describe('session cookie names', () => {
  it('keeps legacy names unless a namespace is specified', () => {
    expect(sessionCookieNames()).toEqual({
      secure: '__Secure-better-auth.session_token',
      plain: 'better-auth.session_token',
    })
    expect(sessionCookieNames('feedback')).toEqual({
      secure: '__Secure-feedback.session_token',
      plain: 'feedback.session_token',
    })
  })

  it('prefers the secure cookie and retains Better Auth duplicate-name ordering', () => {
    expect(
      readSessionCookie(
        'feedback.session_token=http; __Secure-feedback.session_token=https',
        'feedback'
      )
    ).toBe('https')
    expect(
      readSessionCookie(
        '__Secure-feedback.session_token=first; __Secure-feedback.session_token=second',
        'feedback'
      )
    ).toBe('first')
  })

  it('decodes values without treating cookie contents or similar names as credentials', () => {
    expect(readSessionCookie('feedback.session_token=token%2Bsignature%3D', 'feedback')).toBe(
      'token+signature='
    )
    expect(readSessionCookie('feedback.session_token=bad%escape', 'feedback')).toBe('bad%escape')
    for (const cookie of [
      'other-feedback.session_token=value',
      'feedback.session_token_suffix=value',
      'theme=feedback.session_token=value',
      'better-auth.session_token=value',
      '__Secure-better-auth.session_token=value',
      'feedback.session_token=',
    ])
      expect(hasSessionCookie(cookie, 'feedback')).toBe(false)
  })
})
