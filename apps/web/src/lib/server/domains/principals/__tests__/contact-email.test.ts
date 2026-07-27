import { describe, it, expect } from 'vitest'
import {
  CONTACT_EMAIL_TTL_MS,
  acceptableContactEmail,
  buildContactEmailChallenge,
  readContactEmailChallenge,
} from '../contact-email'

/**
 * A person signing in through a provider that releases no email gets a minted
 * placeholder, which cannot receive anything. This is how they supply a real
 * address afterwards. It is the second writer of `principal.contactEmail` — the
 * messenger capture being the first — and the first one driven by the person
 * themselves rather than an agent.
 */
describe('acceptableContactEmail', () => {
  it('accepts an ordinary address, normalised', () => {
    expect(acceptableContactEmail('  Person@Example.com ')).toBe('person@example.com')
  })

  it('rejects anything that is not an address', () => {
    for (const bad of ['', '   ', 'person', 'person@', '@example.com', 'a b@example.com']) {
      expect(acceptableContactEmail(bad)).toBeNull()
    }
  })

  it('rejects the reserved placeholder domain', () => {
    // Accepting one would let somebody set an undeliverable address as their
    // contact address, which is the exact state this feature exists to escape.
    expect(acceptableContactEmail('sso-oidc-abc-deadbeef@anon.quackback.io')).toBeNull()
    expect(acceptableContactEmail('temp-123@anon.quackback.io')).toBeNull()
  })

  it('rejects an address long enough to be an attack on storage', () => {
    expect(acceptableContactEmail(`${'a'.repeat(300)}@example.com`)).toBeNull()
  })
})

describe('buildContactEmailChallenge', () => {
  it('produces a token that is not derivable from the inputs', () => {
    const a = buildContactEmailChallenge('principal_1', 'person@example.com')
    const b = buildContactEmailChallenge('principal_1', 'person@example.com')
    expect(a.token).not.toBe(b.token)
    expect(a.token.length).toBeGreaterThanOrEqual(32)
  })

  it('namespaces the identifier so it cannot collide with sign-in tokens', () => {
    // The verification table is shared with magic-link and OTP. An unnamespaced
    // token would be a second way to satisfy one of those lookups.
    const { identifier } = buildContactEmailChallenge('principal_1', 'person@example.com')
    expect(identifier.startsWith('contact-email:')).toBe(true)
  })

  it('expires, and not far in the future', () => {
    const { expiresAt } = buildContactEmailChallenge('principal_1', 'person@example.com')
    const ms = expiresAt.getTime() - Date.now()
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(CONTACT_EMAIL_TTL_MS)
  })

  it('round-trips the principal and the address it was issued for', () => {
    const built = buildContactEmailChallenge('principal_1', 'person@example.com')
    expect(readContactEmailChallenge(built.value)).toEqual({
      principalId: 'principal_1',
      email: 'person@example.com',
    })
  })
})

describe('readContactEmailChallenge', () => {
  it('returns null for anything it did not write', () => {
    // The row could hold a value from another feature or a hand-edited one.
    // Confirming against a shape we do not recognise must not write anything.
    for (const bad of ['', 'not json', '{}', '{"email":"person@example.com"}', '[]', 'null']) {
      expect(readContactEmailChallenge(bad)).toBeNull()
    }
  })

  it('rejects a stored address that is no longer acceptable', () => {
    // Defence in depth: the address was validated when issued, but the row
    // outlives that check and is what actually gets written.
    const value = JSON.stringify({
      principalId: 'principal_1',
      email: 'temp-1@anon.quackback.io',
    })
    expect(readContactEmailChallenge(value)).toBeNull()
  })
})
