import { describe, it, expect } from 'vitest'
import { buildNavItems } from '../portal-header-nav'

describe('buildNavItems', () => {
  it('returns feedback/roadmap/changelog when help center is disabled', () => {
    const items = buildNavItems({ helpCenterEnabled: false, helpCenterHost: false })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog'])
  })

  it('adds Help tab when help center is enabled', () => {
    const items = buildNavItems({ helpCenterEnabled: true, helpCenterHost: false })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/hc'])
  })

  it('only shows Help tab on the help center subdomain', () => {
    const items = buildNavItems({ helpCenterEnabled: true, helpCenterHost: true })
    expect(items.map((i) => i.to)).toEqual(['/hc'])
  })

  it('shows no tabs on the help center subdomain when help center is disabled', () => {
    const items = buildNavItems({ helpCenterEnabled: false, helpCenterHost: true })
    expect(items).toHaveLength(0)
  })
})
