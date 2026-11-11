import { describe, expect, it } from 'vitest'
import { isPortalPath } from '../__root'

describe('isPortalPath', () => {
  it('is the portal’s own pages, which wear the portal’s theme', () => {
    expect(isPortalPath('/')).toBe(true)
    expect(isPortalPath('/feedback')).toBe(true)
    expect(isPortalPath('/hc/getting-started')).toBe(true)
  })

  it('is not the admin, onboarding or the builder, which follow the admin’s own theme', () => {
    expect(isPortalPath('/admin/feedback')).toBe(false)
    expect(isPortalPath('/onboarding')).toBe(false)
    expect(isPortalPath('/design')).toBe(false)
  })

  it('is the builder’s sample pages, which are portal pages that only share the prefix', () => {
    expect(isPortalPath('/design-sample/help-center')).toBe(true)
    expect(isPortalPath('/design-sample/not-found')).toBe(true)
    expect(isPortalPath('/design/pages')).toBe(false)
    expect(isPortalPath('/admin')).toBe(false)
  })
})
