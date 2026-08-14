import { describe, expect, it } from 'vitest'
import { isPortalOttPath } from '../ott-handler'

describe('isPortalOttPath', () => {
  it('handles widget portal handoff URLs', () => {
    expect(isPortalOttPath('/')).toBe(true)
    expect(isPortalOttPath('/b/ideas')).toBe(true)
    expect(isPortalOttPath('/admin')).toBe(true)
  })

  it('leaves dedicated consume routes alone', () => {
    expect(isPortalOttPath('/auth/open-handoff')).toBe(false)
    expect(isPortalOttPath('/auth/origin-transfer')).toBe(false)
    expect(isPortalOttPath('/auth/widget-handoff')).toBe(false)
    expect(isPortalOttPath('/auth/login')).toBe(false)
  })
})
