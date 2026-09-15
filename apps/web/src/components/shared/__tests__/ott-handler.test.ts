import { describe, expect, it } from 'vitest'
import { isPortalOttPath, portalOttForwardUrl } from '../ott-handler'

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

describe('portalOttForwardUrl', () => {
  it('forwards leftover ott to widget-handoff with the resource as returnTo', () => {
    expect(portalOttForwardUrl('/b/ideas/posts/post_1', '?ott=abc')).toBe(
      '/auth/widget-handoff?ott=abc&returnTo=%2Fb%2Fideas%2Fposts%2Fpost_1'
    )
  })

  it('keeps other query params on returnTo', () => {
    expect(portalOttForwardUrl('/changelog/entry_1', '?ott=abc&locale=fr')).toBe(
      '/auth/widget-handoff?ott=abc&returnTo=%2Fchangelog%2Fentry_1%3Flocale%3Dfr'
    )
  })

  it('returns null without ott or on consume routes', () => {
    expect(portalOttForwardUrl('/b/ideas', '')).toBeNull()
    expect(portalOttForwardUrl('/auth/widget-handoff', '?ott=abc')).toBeNull()
  })
})
