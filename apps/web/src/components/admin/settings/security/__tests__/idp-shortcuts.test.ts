import { describe, it, expect } from 'vitest'
import { inferIdpKind } from '../idp-shortcuts'

describe('inferIdpKind', () => {
  it('does not classify a generic auth.<company> issuer as Okta', () => {
    expect(inferIdpKind('https://auth.acme.com/.well-known/openid-configuration')).toBe('other')
  })
  it('still classifies real Okta hosts', () => {
    expect(inferIdpKind('https://acme.okta.com/.well-known/openid-configuration')).toBe('okta')
  })
})
