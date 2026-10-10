import { describe, it, expect } from 'vitest'
import { rewriteLegacyOAuthCallback } from '../legacy-oauth-callback'

describe('rewriteLegacyOAuthCallback', () => {
  it('rewrites the customer-registered genericOAuth path onto the 1.7 social path', () => {
    const request = new Request(
      'https://feedback.example.com/api/auth/oauth2/callback/acme-idp?code=x&state=y'
    )
    const rewritten = rewriteLegacyOAuthCallback(request)
    const url = new URL(rewritten.url)
    expect(url.pathname).toBe('/api/auth/callback/acme-idp')
    expect(url.searchParams.get('code')).toBe('x')
    expect(url.searchParams.get('state')).toBe('y')
  })

  it('leaves the 1.7 social callback and unrelated auth routes alone', () => {
    const social = new Request('https://feedback.example.com/api/auth/callback/github?code=x')
    expect(rewriteLegacyOAuthCallback(social)).toBe(social)

    const other = new Request('https://feedback.example.com/api/auth/sign-in/email')
    expect(rewriteLegacyOAuthCallback(other)).toBe(other)
  })
})
