import { describe, it, expect } from 'vitest'
import {
  deriveVisibility,
  shouldRenderPublicButton,
  verifiedDomainCount,
} from '../identity-providers.service'

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
