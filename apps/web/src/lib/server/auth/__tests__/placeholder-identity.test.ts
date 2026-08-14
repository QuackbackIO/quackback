import { describe, it, expect } from 'vitest'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'
import { mintPlaceholderEmail, synthesizeName } from '../placeholder-identity'

describe('mintPlaceholderEmail', () => {
  it('mints into the reserved domain so every existing guard recognises it', () => {
    const email = mintPlaceholderEmail('oidc_01j9')
    expect(isSyntheticAnonEmail(email)).toBe(true)
  })

  it('never collides with the anonymous plugin, which owns the temp- prefix', () => {
    const email = mintPlaceholderEmail('oidc_01j9')
    expect(email.startsWith('temp-')).toBe(false)
    expect(email.startsWith('sso-')).toBe(true)
  })

  it('is random rather than derived, so it cannot be pre-registered', () => {
    const a = mintPlaceholderEmail('oidc_01j9')
    const b = mintPlaceholderEmail('oidc_01j9')
    expect(a).not.toBe(b)
  })

  it('carries the provider so an operator can tell where an account came from', () => {
    expect(mintPlaceholderEmail('oidc_01j9')).toContain('oidc-01j9')
  })

  it('sanitises a hostile registration id into a legal local part', () => {
    const email = mintPlaceholderEmail('Weird ID/../with@chars')
    const local = email.split('@')[0]
    expect(local).toMatch(/^sso-[a-z0-9-]+$/)
    expect(email.split('@')).toHaveLength(2)
  })

  it('still mints when the registration id sanitises to nothing', () => {
    const email = mintPlaceholderEmail('///')
    expect(isSyntheticAnonEmail(email)).toBe(true)
    expect(email.split('@')[0]).toMatch(/^sso-[a-z0-9-]+$/)
  })
})

describe('synthesizeName', () => {
  it('prefers a human-chosen handle over anything derived', () => {
    expect(
      synthesizeName({ preferred_username: 'SomePilot', nickname: 'sp' }, 'CHARACTER:REGION:2119')
    ).toBe('SomePilot')
  })

  it('falls back to nickname before touching the subject', () => {
    expect(synthesizeName({ nickname: 'sp' }, 'CHARACTER:REGION:2119')).toBe('sp')
  })

  it('uses the subject only as a last resort, readably', () => {
    const name = synthesizeName({}, 'ACCOUNT:REGION:2119123456')
    expect(name.length).toBeGreaterThan(0)
    expect(name).not.toContain(':')
  })

  it('ignores claim values that are present but not usable', () => {
    expect(synthesizeName({ preferred_username: '   ', nickname: 42 }, 'sub-1')).toBe('sub-1')
  })

  it('always returns a non-empty name, even when everything is hostile', () => {
    expect(synthesizeName({}, '   ').length).toBeGreaterThan(0)
    expect(synthesizeName({}, '').length).toBeGreaterThan(0)
  })

  it('does not leak a full email address into a display name', () => {
    const name = synthesizeName({}, 'person@example.com')
    expect(name).not.toContain('@')
  })
})
