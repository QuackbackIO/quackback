import { describe, it, expect } from 'vitest'
import { allowsAutoLinking } from '../provider-trust'

const verifiedTier = {
  lastSuccessfulTestAt: '2026-07-01T00:00:00Z',
  detailsChangedAt: null,
  assertsVerifiedEmail: true,
  trustOverride: null,
}

describe('allowsAutoLinking', () => {
  it('permits a provider that passed its test and asserts a verified address', () => {
    expect(allowsAutoLinking(verifiedTier)).toBe(true)
  })

  it('refuses a provider that has never passed its connection test', () => {
    // Auto-linking attaches an incoming identity to an EXISTING local account
    // on address match alone. A provider that has not proved it resolves an
    // identity correctly has not earned that.
    expect(allowsAutoLinking({ ...verifiedTier, lastSuccessfulTestAt: null })).toBe(false)
  })

  it('refuses a provider whose test is stale', () => {
    // Config changed after the last pass, so the pass vouches for a
    // configuration that is no longer in effect.
    expect(allowsAutoLinking({ ...verifiedTier, detailsChangedAt: '2026-07-02T00:00:00Z' })).toBe(
      false
    )
  })

  it('refuses a provider that does not assert a verified address', () => {
    // This is what separates a corporate IdP, where the workspace controls who
    // can hold an identity, from a public one where anyone in the world can
    // register the address of someone who already has a local account.
    expect(allowsAutoLinking({ ...verifiedTier, assertsVerifiedEmail: false })).toBe(false)
  })

  it('honours an explicit admin override in both directions', () => {
    // Some IdPs under-report; an admin who knows better can force it on, and
    // one who wants it off can force that too.
    expect(
      allowsAutoLinking({ ...verifiedTier, assertsVerifiedEmail: false, trustOverride: true })
    ).toBe(true)
    expect(allowsAutoLinking({ ...verifiedTier, trustOverride: false })).toBe(false)
  })

  it('treats a test at exactly the change time as stale', () => {
    expect(
      allowsAutoLinking({
        ...verifiedTier,
        lastSuccessfulTestAt: '2026-07-01T00:00:00Z',
        detailsChangedAt: '2026-07-01T00:00:00Z',
      })
    ).toBe(false)
  })
})
