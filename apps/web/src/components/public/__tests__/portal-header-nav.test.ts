import { describe, it, expect } from 'vitest'
import { buildNavItems } from '../portal-header-nav'

describe('buildNavItems', () => {
  it('returns feedback/roadmap/changelog when help center is disabled and signed out', () => {
    const items = buildNavItems({ helpCenterEnabled: false })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog'])
  })

  it('adds Help tab when help center is enabled (signed out)', () => {
    const items = buildNavItems({ helpCenterEnabled: true })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/hc'])
  })

  it('inserts My tickets between base items and Help when signed in', () => {
    const items = buildNavItems({ helpCenterEnabled: true, isSignedIn: true })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/tickets', '/hc'])
  })

  it('omits My tickets for signed-out users even with help disabled', () => {
    const items = buildNavItems({ helpCenterEnabled: false, isSignedIn: false })
    expect(items.map((i) => i.to)).not.toContain('/tickets')
  })

  it('appends My tickets when help center is disabled but user is signed in', () => {
    const items = buildNavItems({ helpCenterEnabled: false, isSignedIn: true })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/tickets'])
  })

  it('adds Support tab when portal support is enabled', () => {
    const items = buildNavItems({ helpCenterEnabled: false, supportEnabled: true })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/support'])
  })

  it('orders Help before Support when both are enabled', () => {
    const items = buildNavItems({ helpCenterEnabled: true, supportEnabled: true })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/hc', '/support'])
  })

  it('shows tickets, help, and support when all enabled and signed in', () => {
    const items = buildNavItems({ helpCenterEnabled: true, isSignedIn: true, supportEnabled: true })
    expect(items.map((i) => i.to)).toEqual([
      '/',
      '/roadmap',
      '/changelog',
      '/tickets',
      '/hc',
      '/support',
    ])
  })
})
