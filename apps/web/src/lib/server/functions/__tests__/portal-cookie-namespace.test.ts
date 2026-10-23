import { describe, expect, it } from 'vitest'

import { extractSessionTokenFromCookie } from '../portal-session-token'

describe('portal session cookie namespace', () => {
  it('extracts the configured HTTPS cookie despite an unrelated parent-domain cookie', () => {
    expect(
      extractSessionTokenFromCookie(
        '__Secure-better-auth.session_token=other.signature; __Secure-feedback.session_token=own.signature',
        'feedback'
      )
    ).toBe('own.signature')
  })

  it('recognises the configured HTTP cookie', () => {
    expect(extractSessionTokenFromCookie('feedback.session_token=own.signature', 'feedback')).toBe(
      'own.signature'
    )
  })

  it.each([
    'better-auth.session_token=other.signature',
    '__Secure-better-auth.session_token=other.signature',
    'not-feedback.session_token=other.signature',
    'theme=feedback.session_token=other.signature',
    '__Secure-feedback.session_token.extra=other.signature',
  ])('does not mistake another cookie for a configured session: %s', (cookie) => {
    expect(extractSessionTokenFromCookie(cookie, 'feedback')).toBeNull()
  })
})
