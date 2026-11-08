/**
 * One table says what the right panel shows for a pick: its panel, its
 * breadcrumb, and where Escape goes up to. Nothing picked shows the page.
 */
import { describe, expect, it } from 'vitest'
import { panelFor, upOf } from '../panel-routes'

const names: Record<string, string> = { 'block-a': 'Top posts', 'link:docs': 'Docs' }
const nameOf = (key: string | null) => (key ? names[key] : undefined)

describe('panelFor', () => {
  it('shows the page with nothing picked, and for the site or a pick it has no panel for', () => {
    // The words panel is gone: words are edited where each page draws them.
    for (const pick of [null, 'site', 'site:brand', 'site:words', 'nonsense'] as const)
      expect(panelFor(pick as never, false, 'roadmap', nameOf)).toMatchObject({
        panel: 'page',
        crumbs: [{ label: 'Roadmap' }],
      })
  })

  it('names each panel and the way up to the page', () => {
    expect(panelFor('header', false, 'roadmap', nameOf)).toEqual({
      panel: 'header',
      crumbs: [{ label: 'Roadmap', to: null }, { label: 'Header and menu' }],
      up: null,
    })
    expect(panelFor('hero', false, 'help', nameOf).crumbs).toEqual([
      { label: 'Help Center', to: null },
      { label: 'Hero' },
    ])
    expect(panelFor('composer', false, 'feedback', nameOf)).toMatchObject({
      panel: 'part',
      crumbs: [{ label: 'Feedback', to: null }, { label: 'Composer' }],
    })
    expect(panelFor('feed', false, 'feedback', nameOf)).toMatchObject({
      panel: 'part',
      crumbs: [{ label: 'Feedback', to: null }, { label: 'Feed' }],
    })
    expect(panelFor('entries', false, 'changelog', nameOf).panel).toBe('section')
  })

  it('puts a menu link under the header, and a Home block under Blocks', () => {
    expect(panelFor('link:docs', false, 'home', nameOf)).toEqual({
      panel: 'link',
      crumbs: [
        { label: 'Home', to: null },
        { label: 'Header and menu', to: 'header' },
        { label: 'Docs' },
      ],
      up: 'header',
    })
    expect(panelFor('block-a', false, 'home', nameOf)).toEqual({
      panel: 'block',
      crumbs: [
        { label: 'Home', to: null },
        { label: 'Blocks', to: 'home' },
        { label: 'Top posts' },
      ],
      up: 'home',
    })
    expect(panelFor('home', false, 'home', nameOf).panel).toBe('blocks')
  })

  it('puts the logo under the header, as its own element', () => {
    expect(panelFor('logo', false, 'roadmap', nameOf)).toEqual({
      panel: 'logo',
      crumbs: [
        { label: 'Roadmap', to: null },
        { label: 'Header and menu', to: 'header' },
        { label: 'Logo' },
      ],
      up: 'header',
    })
  })

  it('shows the header for a page of the menu, which has no panel of its own', () => {
    expect(panelFor('page:roadmap', false, 'home', nameOf).panel).toBe('header')
  })

  it('gives a picked element its own panel, under its block', () => {
    expect(panelFor('block-a', true, 'home', nameOf)).toMatchObject({
      panel: 'element',
      up: 'block-a',
    })
  })
})

describe('upOf', () => {
  it('goes up one level, and from the page to nothing', () => {
    expect(upOf('block-a')).toBe('home')
    expect(upOf('link:docs')).toBe('header')
    expect(upOf('logo')).toBe('header')
    expect(upOf('hero')).toBeNull()
    expect(upOf('home')).toBeNull()
    expect(upOf(null)).toBeNull()
  })
})
