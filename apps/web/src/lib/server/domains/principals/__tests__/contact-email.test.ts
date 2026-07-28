import { describe, it, expect } from 'vitest'
import { acceptableContactEmail } from '../contact-email'

/**
 * The gate on every address this system will send to. The reserved-domain
 * rejection is the load-bearing one: it is what stops a synthetic placeholder
 * landing on `user.email`, where the rest of the system reads it as "no
 * address" and the transport refuses to deliver to it.
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
    // Accepting one would let somebody re-enter the undeliverable state the
    // set-your-address flow exists to escape.
    expect(acceptableContactEmail('sso-oidc-abc-deadbeef@anon.quackback.io')).toBeNull()
    expect(acceptableContactEmail('temp-123@anon.quackback.io')).toBeNull()
  })

  it('rejects an address long enough to be an attack on storage', () => {
    expect(acceptableContactEmail(`${'a'.repeat(300)}@example.com`)).toBeNull()
  })
})
