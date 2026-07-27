import { describe, it, expect } from 'vitest'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'
import { mintPlaceholderEmail, synthesizeName } from '../placeholder-identity'

/**
 * World C: a provider that releases no email and sometimes no name either.
 * Sign-in fails outright today. These two functions are what let an account
 * exist at all, so their failure modes matter more than their happy path.
 */
describe('mintPlaceholderEmail', () => {
  it('mints into the reserved domain so every existing guard recognises it', () => {
    // ~110 call sites route through realEmail()/isSyntheticAnonEmail, and the
    // transport refuses to deliver to this domain. Minting anywhere else would
    // mean a fake address that looks deliverable.
    const email = mintPlaceholderEmail('oidc_01j9')
    expect(isSyntheticAnonEmail(email)).toBe(true)
  })

  it('never collides with the anonymous plugin, which owns the temp- prefix', () => {
    // Better Auth mints temp-<id>@ for anonymous users in the same domain.
    // Sharing a prefix would make the two populations indistinguishable.
    const email = mintPlaceholderEmail('oidc_01j9')
    expect(email.startsWith('temp-')).toBe(false)
    expect(email.startsWith('sso-')).toBe(true)
  })

  it('is random rather than derived, so it cannot be pre-registered', () => {
    // A deterministic address computed from a public subject can be claimed by
    // someone else first, leaving the real person permanently unlinkable. Two
    // mints for the same provider must differ.
    const a = mintPlaceholderEmail('oidc_01j9')
    const b = mintPlaceholderEmail('oidc_01j9')
    expect(a).not.toBe(b)
  })

  it('carries the provider so an operator can tell where an account came from', () => {
    // Sanitised into the local part: `oidc_01j9` reads as `oidc-01j9`.
    expect(mintPlaceholderEmail('oidc_01j9')).toContain('oidc-01j9')
  })

  it('sanitises a hostile registration id into a legal local part', () => {
    const email = mintPlaceholderEmail('Weird ID/../with@chars')
    const local = email.split('@')[0]
    expect(local).toMatch(/^sso-[a-z0-9-]+$/)
    // Exactly one @, or the address is not addressable at all.
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
      synthesizeName({ preferred_username: 'SomePilot', nickname: 'sp' }, 'CHARACTER:EVE:2119')
    ).toBe('SomePilot')
  })

  it('falls back to nickname before touching the subject', () => {
    expect(synthesizeName({ nickname: 'sp' }, 'CHARACTER:EVE:2119')).toBe('sp')
  })

  it('uses the subject only as a last resort, readably', () => {
    // The raw subject is an opaque identifier. It is better than an empty name
    // in an admin list, but it should not look like a system string.
    const name = synthesizeName({}, 'ACCOUNT:REGION:2119123456')
    expect(name.length).toBeGreaterThan(0)
    expect(name).not.toContain(':')
  })

  it('ignores claim values that are present but not usable', () => {
    expect(synthesizeName({ preferred_username: '   ', nickname: 42 }, 'sub-1')).toBe('sub-1')
  })

  it('always returns a non-empty name, even when everything is hostile', () => {
    // A name is required to create the account. Returning '' here would move
    // the failure to a database constraint at the worst possible moment.
    expect(synthesizeName({}, '   ').length).toBeGreaterThan(0)
    expect(synthesizeName({}, '').length).toBeGreaterThan(0)
  })

  it('does not leak a full email address into a display name', () => {
    // Some providers put an address in `sub`. Rendering it as a display name
    // publishes it on posts and comments.
    const name = synthesizeName({}, 'person@example.com')
    expect(name).not.toContain('@')
  })
})
