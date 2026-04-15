import { describe, it, expect } from 'vitest'
import { buildNavItems } from '../portal-header-nav'

describe('buildNavItems', () => {
  it('returns feedback/roadmap/changelog when help center is disabled', () => {
    const items = buildNavItems({ helpCenterEnabled: false })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog'])
  })

  it('adds Help tab when help center is enabled', () => {
    const items = buildNavItems({ helpCenterEnabled: true })
    expect(items.map((i) => i.to)).toEqual(['/', '/roadmap', '/changelog', '/hc'])
  })
})
