import { describe, it, expect } from 'vitest'
import { extractSessionTokenFromCookie } from '../portal-session-token'

describe('extractSessionTokenFromCookie', () => {
  it('returns the signed token value from a valid cookie header', () => {
    const cookie = 'better-auth.session_token=abc123.signature456; other=value'
    expect(extractSessionTokenFromCookie(cookie)).toBe('abc123.signature456')
  })

  it('returns null when cookie header is empty', () => {
    expect(extractSessionTokenFromCookie('')).toBeNull()
  })

  it('returns null when session token cookie is not present', () => {
    const cookie = 'theme=dark; lang=en'
    expect(extractSessionTokenFromCookie(cookie)).toBeNull()
  })

  it('handles URL-encoded cookie values', () => {
    const encoded = encodeURIComponent('uuid-value.hmac-signature')
    const cookie = `better-auth.session_token=${encoded}; other=x`
    expect(extractSessionTokenFromCookie(cookie)).toBe('uuid-value.hmac-signature')
  })

  it('handles cookie with no other values', () => {
    const cookie = 'better-auth.session_token=token.sig'
    expect(extractSessionTokenFromCookie(cookie)).toBe('token.sig')
  })

  it('handles cookie with spaces around semicolons', () => {
    const cookie = 'a=1 ; better-auth.session_token=tok.sig ; b=2'
    expect(extractSessionTokenFromCookie(cookie)).toBe('tok.sig')
  })

  it('returns null for null input', () => {
    expect(extractSessionTokenFromCookie(null as unknown as string)).toBeNull()
  })
})
