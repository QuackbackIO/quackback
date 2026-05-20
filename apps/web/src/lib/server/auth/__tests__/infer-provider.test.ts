/**
 * `inferProvider` — the path/params/body → provider-id mapping that
 * drives every auth hook decision.
 *
 * The Better-Auth route templates we care about:
 *   - /sign-in/email                        → 'credential'
 *   - /sign-up/email                        → 'credential'  (same policy as sign-in)
 *   - /sign-in/magic-link                   → 'magic-link'
 *   - /magic-link/verify                    → 'magic-link'
 *   - /email-otp/send-verification-otp      → 'magic-link'  (OTP folded in)
 *   - /sign-in/email-otp                    → 'magic-link'
 *   - /sign-in/social                       → body.provider
 *   - /callback/:id                         → params.id
 *   - /sign-in/oauth2                       → body.providerId
 *   - /oauth2/callback/:providerId          → params.providerId
 *
 * If this mapping drifts (e.g. a Better-Auth upgrade renames a path)
 * every policy in `auth-restrictions` silently no-ops because
 * `provider === null` short-circuits. The unit test holds the contract.
 */
import { describe, it, expect } from 'vitest'
import { inferProvider } from '../hooks'

describe('inferProvider — credential / magic-link paths', () => {
  it('returns credential for /sign-in/email', () => {
    expect(inferProvider({ path: '/sign-in/email' })).toBe('credential')
  })

  it('returns credential for /sign-up/email (signup shares the policy)', () => {
    expect(inferProvider({ path: '/sign-up/email' })).toBe('credential')
  })

  it('returns magic-link for /sign-in/magic-link', () => {
    expect(inferProvider({ path: '/sign-in/magic-link' })).toBe('magic-link')
  })

  it('returns magic-link for /magic-link/verify', () => {
    expect(inferProvider({ path: '/magic-link/verify' })).toBe('magic-link')
  })

  it('returns magic-link for /email-otp/send-verification-otp (OTP folded into magic-link)', () => {
    expect(inferProvider({ path: '/email-otp/send-verification-otp' })).toBe('magic-link')
  })

  it('returns magic-link for /sign-in/email-otp', () => {
    expect(inferProvider({ path: '/sign-in/email-otp' })).toBe('magic-link')
  })
})

describe('inferProvider — OAuth paths', () => {
  it('returns body.provider for /sign-in/social', () => {
    expect(inferProvider({ path: '/sign-in/social', body: { provider: 'google' } })).toBe('google')
  })

  it('returns null for /sign-in/social when body.provider is missing', () => {
    expect(inferProvider({ path: '/sign-in/social', body: {} })).toBeNull()
  })

  it('returns null for /sign-in/social when body.provider is not a string', () => {
    expect(inferProvider({ path: '/sign-in/social', body: { provider: 42 } })).toBeNull()
  })

  it('returns params.id for /callback/:id', () => {
    expect(inferProvider({ path: '/callback/:id', params: { id: 'github' } })).toBe('github')
  })

  it('returns body.providerId for /sign-in/oauth2', () => {
    expect(inferProvider({ path: '/sign-in/oauth2', body: { providerId: 'sso' } })).toBe('sso')
  })

  it('returns params.providerId for /oauth2/callback/:providerId', () => {
    expect(
      inferProvider({
        path: '/oauth2/callback/:providerId',
        params: { providerId: 'sso' },
      })
    ).toBe('sso')
  })

  it('returns google for /oauth2/callback/:providerId with providerId=google', () => {
    expect(
      inferProvider({
        path: '/oauth2/callback/:providerId',
        params: { providerId: 'google' },
      })
    ).toBe('google')
  })
})

describe('inferProvider — guards', () => {
  it('returns null for an unknown path', () => {
    expect(inferProvider({ path: '/some/unknown/route' })).toBeNull()
  })

  it('returns null when path is missing', () => {
    expect(inferProvider({})).toBeNull()
  })

  it('returns null for /sign-out (not a sign-in path)', () => {
    expect(inferProvider({ path: '/sign-out' })).toBeNull()
  })

  it('returns null for session/jwt management paths', () => {
    expect(inferProvider({ path: '/get-session' })).toBeNull()
    expect(inferProvider({ path: '/jwt' })).toBeNull()
  })
})
