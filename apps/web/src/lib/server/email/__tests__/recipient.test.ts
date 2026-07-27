import { describe, it, expect } from 'vitest'
import { contactRecipientFrom, sealedRecipient } from '../recipient'

const PLACEHOLDER = 'sso-oidc-abc-deadbeef@anon.quackback.io'
const ANON = 'temp-01j9@anon.quackback.io'

/**
 * The contact class is the only one that may follow an address someone other
 * than the account owner supplied. These tests pin the precedence; the rule it
 * must never be used for lives in the security-mail source scan.
 */
describe('contactRecipientFrom', () => {
  it('prefers the account address when it is real', () => {
    expect(
      contactRecipientFrom({ accountEmail: 'real@x.com', contactEmail: 'contact@x.com' })
    ).toBe('real@x.com')
  })

  it('falls through a placeholder account address to the contact address', () => {
    // The case the whole module exists for: a placeholder is truthy, so a
    // plain `??` on the raw fields would hand it back and the transport would
    // then drop the send silently.
    expect(contactRecipientFrom({ accountEmail: PLACEHOLDER, contactEmail: 'contact@x.com' })).toBe(
      'contact@x.com'
    )
    expect(contactRecipientFrom({ accountEmail: ANON, contactEmail: 'contact@x.com' })).toBe(
      'contact@x.com'
    )
  })

  it('returns null rather than a placeholder when nothing real is on file', () => {
    expect(contactRecipientFrom({ accountEmail: PLACEHOLDER, contactEmail: null })).toBeNull()
    expect(contactRecipientFrom({ accountEmail: PLACEHOLDER, contactEmail: ANON })).toBeNull()
    expect(contactRecipientFrom({ accountEmail: null, contactEmail: undefined })).toBeNull()
  })
})

describe('sealedRecipient', () => {
  it('returns the minted address byte-for-byte', () => {
    // Any normalisation here would send the token to an address the
    // verification row does not match, so it cannot be redeemed — or, if the
    // drift went the other way, to one it should not reach.
    for (const addr of ['Person@Example.com', 'person+tag@example.com', '  spaced@x.com  ']) {
      expect(sealedRecipient({ sealedAddress: addr })).toBe(addr)
    }
  })
})
