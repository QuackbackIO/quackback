import { describe, it, expect } from 'vitest'
import { mapProfileClaims } from '../map-profile-claims'

describe('mapProfileClaims — locale', () => {
  it('takes a non-empty string locale', () => {
    expect(mapProfileClaims({ locale: 'pt-BR' }).locale).toBe('pt-BR')
  })

  it('nulls an absent, empty, or non-string locale', () => {
    expect(mapProfileClaims({}).locale).toBeNull()
    expect(mapProfileClaims({ locale: '' }).locale).toBeNull()
    expect(mapProfileClaims({ locale: 42 }).locale).toBeNull()
    expect(mapProfileClaims(null).locale).toBeNull()
    expect(mapProfileClaims(undefined).locale).toBeNull()
  })
})

describe('mapProfileClaims — emailVerified', () => {
  it('honours a literal boolean true', () => {
    expect(mapProfileClaims({ email_verified: true }).emailVerified).toBe(true)
  })

  it('accepts the string "true" for bridges that stringify booleans', () => {
    expect(mapProfileClaims({ email_verified: 'true' }).emailVerified).toBe(true)
    expect(mapProfileClaims({ email_verified: 'TRUE' }).emailVerified).toBe(true)
  })

  it('does NOT treat the string "false" as verified', () => {
    // The defect: the claim was consumed by truthiness, so a SAML-to-OIDC
    // bridge emitting the string "false" marked the local account verified.
    // That renders a verified badge, ships as a boolean on the public API, and
    // satisfies the linking guard.
    expect(mapProfileClaims({ email_verified: 'false' }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: 'False' }).emailVerified).toBe(false)
  })

  it('rejects every other truthy-but-not-affirmative shape', () => {
    expect(mapProfileClaims({ email_verified: 1 }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: 'yes' }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: {} }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: [] }).emailVerified).toBe(false)
  })

  it('defaults to false when the claim is absent or explicitly false', () => {
    expect(mapProfileClaims({}).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: false }).emailVerified).toBe(false)
    expect(mapProfileClaims({ email_verified: null }).emailVerified).toBe(false)
  })
})
