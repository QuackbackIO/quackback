import { describe, it, expect } from 'vitest'
import {
  effectiveSignInMethods,
  isSignInMethodEnabled,
  normalizeMethodKey,
} from '../signin-methods'

describe('isSignInMethodEnabled', () => {
  it('password defaults on (missing or undefined → enabled)', () => {
    expect(isSignInMethodEnabled({}, 'password')).toBe(true)
    expect(isSignInMethodEnabled(undefined, 'password')).toBe(true)
    expect(isSignInMethodEnabled({ password: false }, 'password')).toBe(false)
  })
  it('magicLink defaults off (only explicit true enables)', () => {
    expect(isSignInMethodEnabled({}, 'magicLink')).toBe(false)
    expect(isSignInMethodEnabled({ magicLink: true }, 'magicLink')).toBe(true)
  })
  it('social providers default off, only explicit true enables', () => {
    expect(isSignInMethodEnabled({}, 'google')).toBe(false)
    expect(isSignInMethodEnabled({ google: true }, 'google')).toBe(true)
    expect(isSignInMethodEnabled({ google: false }, 'google')).toBe(false)
  })
})

describe('normalizeMethodKey', () => {
  it('maps path-derived provider ids to config keys', () => {
    expect(normalizeMethodKey('credential')).toBe('password')
    expect(normalizeMethodKey('password')).toBe('password')
    expect(normalizeMethodKey('magic-link')).toBe('magicLink')
    expect(normalizeMethodKey('email')).toBe('magicLink')
    expect(normalizeMethodKey('google')).toBe('google')
  })
})

describe('effectiveSignInMethods', () => {
  const ssoOnly = { password: false, magicLink: false }

  it('offers email links when providers are set up but single sign-on is not live', () => {
    const effective = effectiveSignInMethods({
      stored: ssoOnly,
      ssoLive: false,
      providersConfigured: true,
    })
    expect(isSignInMethodEnabled(effective, 'magicLink')).toBe(true)
    // Everything else is exactly as stored.
    expect(isSignInMethodEnabled(effective, 'password')).toBe(false)
  })

  it('returns the stored methods unchanged while single sign-on is live', () => {
    expect(
      effectiveSignInMethods({ stored: ssoOnly, ssoLive: true, providersConfigured: true })
    ).toEqual(ssoOnly)
  })

  it('returns the stored methods unchanged when no provider is set up', () => {
    expect(
      effectiveSignInMethods({ stored: ssoOnly, ssoLive: false, providersConfigured: false })
    ).toEqual(ssoOnly)
  })

  it('never changes the stored object it was given', () => {
    const stored = { ...ssoOnly }
    effectiveSignInMethods({ stored, ssoLive: false, providersConfigured: true })
    expect(stored).toEqual(ssoOnly)
  })

  it('treats a missing stored map as the defaults', () => {
    const effective = effectiveSignInMethods({
      stored: undefined,
      ssoLive: false,
      providersConfigured: true,
    })
    expect(isSignInMethodEnabled(effective, 'magicLink')).toBe(true)
    expect(isSignInMethodEnabled(effective, 'password')).toBe(true)
  })
})
