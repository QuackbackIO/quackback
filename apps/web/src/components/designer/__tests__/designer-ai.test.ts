import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/portal-design-ai', () => ({}))
vi.mock('@/lib/client/mutations/settings', () => ({}))
vi.mock('@/lib/client/queries/portal-design', () => ({}))

const { aiScopeOf } = await import('../designer-ai')

describe('aiScopeOf', () => {
  it('keeps a request to the part selected, and a block to itself', () => {
    expect(aiScopeOf(null)).toEqual({ scope: 'site' })
    expect(aiScopeOf('site')).toEqual({ scope: 'brand' })
    expect(aiScopeOf('hero')).toEqual({ scope: 'band' })
    expect(aiScopeOf('feed')).toEqual({ scope: 'feed' })
    expect(aiScopeOf('block-linksblock1')).toEqual({ scope: 'home', blockId: 'linksblock1' })
    expect(aiScopeOf('site:brand')).toEqual({ scope: 'brand' })
    expect(aiScopeOf('site:styles')).toEqual({ scope: 'brand' })
    // An item of the menu is in the header.
    expect(aiScopeOf('page:help')).toEqual({ scope: 'header' })
    expect(aiScopeOf('link:docs')).toEqual({ scope: 'header' })
    // The logo is its own element, reaching the logo's fields.
    expect(aiScopeOf('logo')).toEqual({ scope: 'logo' })
  })

  it('keeps a request about a page’s section to that page', () => {
    expect(aiScopeOf('entries')).toEqual({ scope: 'changelog' })
    expect(aiScopeOf('topics')).toEqual({ scope: 'help' })
    expect(aiScopeOf('popular')).toEqual({ scope: 'help' })
    expect(aiScopeOf('board')).toEqual({ scope: 'roadmap' })
  })
})
