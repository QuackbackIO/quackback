import { describe, expect, it } from 'vitest'
import { isPortalAddress } from '../portal-address-space'

describe('isPortalAddress', () => {
  it('answers unknown portal addresses with the portal', () => {
    expect(isPortalAddress('/nope')).toBe(true)
    expect(isPortalAddress('/b/bugs/nothing/here')).toBe(true)
    expect(isPortalAddress('/feedback/extra')).toBe(true)
  })

  it('leaves the admin, the API, sign-in and the widget to the plain page', () => {
    for (const path of [
      '/admin/nope',
      '/api/nope',
      '/auth/x',
      '/widget/x',
      '/design/x',
      '/ADMIN/x',
    ])
      expect(isPortalAddress(path), path).toBe(false)
  })
})
