import { describe, it, expect } from 'vitest'
import { isSignInMethodEnabled, normalizeMethodKey } from '../signin-methods'

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
