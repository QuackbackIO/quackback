import { describe, it, expect } from 'vitest'
import {
  connectionAffectingChange,
  deriveVisibility,
  shouldRenderPublicButton,
  verifiedDomainCount,
} from '../identity-providers.service'

describe('connectionAffectingChange', () => {
  const existing = {
    clientId: 'client-1',
    discoveryUrl: 'https://idp/.well-known/openid-configuration',
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
  }

  it('is false when no connection-affecting field is supplied', () => {
    // Patch semantics: an unsupplied field must not restamp the baseline and
    // invalidate a passing test for an unrelated edit (e.g. renaming a label).
    expect(connectionAffectingChange({ clientId: 'client-1' }, existing)).toBe(false)
  })

  it('is true when the client id changes', () => {
    expect(connectionAffectingChange({ clientId: 'client-2' }, existing)).toBe(true)
  })

  it('is true when an endpoint changes', () => {
    expect(
      connectionAffectingChange({ clientId: 'client-1', tokenUrl: 'https://idp/token' }, existing)
    ).toBe(true)
  })

  it('is true when scopes change', () => {
    // Regression: scopes decide which claims the IdP releases, which is exactly
    // what the connection test validates. Omitting them let a stale passing test
    // keep vouching for a scope set it never exercised.
    expect(connectionAffectingChange({ clientId: 'client-1', scopes: 'openid' }, existing)).toBe(
      true
    )
  })

  it('is false when scopes are supplied but unchanged', () => {
    expect(
      connectionAffectingChange(
        { clientId: 'client-1', scopes: null },
        { ...existing, scopes: null }
      )
    ).toBe(false)
  })

  it('is true when claimMapping.profile changes', () => {
    expect(
      connectionAffectingChange(
        { claimMapping: { profile: { allowMissingEmail: true } } },
        { ...existing, claimMapping: null }
      )
    ).toBe(true)
  })

  it('is false when only claimMapping.role or attributes change', () => {
    expect(
      connectionAffectingChange(
        { claimMapping: { role: { claimPath: 'groups', rules: [] } } },
        { ...existing, claimMapping: null }
      )
    ).toBe(false)
    expect(
      connectionAffectingChange(
        {
          claimMapping: {
            attributes: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
          },
        },
        { ...existing, claimMapping: null }
      )
    ).toBe(false)
  })
})

describe('identity providers visibility', () => {
  it('button when no verified domain', () => {
    expect(deriveVisibility({ domains: [] })).toBe('button')
    expect(deriveVisibility({ domains: [{ verifiedAt: null }] as any })).toBe('button')
  })

  it('routed when a verified domain exists', () => {
    expect(deriveVisibility({ domains: [{ verifiedAt: '2026-01-01T00:00:00Z' }] as any })).toBe(
      'routed'
    )
    // A mix of pending + verified still routes.
    expect(deriveVisibility({ domains: [{ verifiedAt: null }, { verifiedAt: 'x' }] as any })).toBe(
      'routed'
    )
  })

  it('public button visibility is governed solely by showButton', () => {
    // Off hides the provider even with no verified domain (parked); on shows
    // it whether it is button-only or also routed by a verified domain.
    expect(shouldRenderPublicButton({ showButton: false })).toBe(false)
    expect(shouldRenderPublicButton({ showButton: true })).toBe(true)
  })

  it('verifiedDomainCount counts only domains with a truthy verifiedAt', () => {
    expect(verifiedDomainCount({ domains: [] })).toBe(0)
    expect(
      verifiedDomainCount({
        domains: [{ verifiedAt: null }, { verifiedAt: 'x' }, { verifiedAt: 'y' }] as any,
      })
    ).toBe(2)
  })
})
