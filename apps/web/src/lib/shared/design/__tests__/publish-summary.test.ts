import { describe, expect, it } from 'vitest'
import { designChanges } from '../diff'
import { defaultDesign, type PortalDesign } from '../schema'
import { FULL_REVIEW_OVER, opensFullReview, publishSummary } from '../publish-summary'

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

function summary(change: (draft: PortalDesign) => void) {
  const live = defaultDesign()
  const draft = structuredClone(live)
  change(draft)
  return publishSummary(live, draft, designChanges(live, draft), gates)
}

describe('when the full review opens itself', () => {
  it('opens for more than twelve changes', () => {
    expect(FULL_REVIEW_OVER).toBe(12)
    expect(opensFullReview(12, 0)).toBe(false)
    expect(opensFullReview(13, 0)).toBe(true)
  })

  it('opens for a check that fails, however few the changes', () => {
    expect(opensFullReview(1, 1)).toBe(true)
    expect(opensFullReview(1, 0)).toBe(false)
  })
})

describe('the publish summary', () => {
  it('says where visitors land when that changes, and that the logo goes there too', () => {
    const { menu } = summary((draft) => {
      draft.nav.items = [
        { type: 'help', shown: true, label: 'Help' },
        ...draft.nav.items.filter((item) => item.type !== 'help'),
      ]
    })
    expect(menu[0]).toEqual({
      kind: 'Landing',
      title: 'Visitors land on Help',
      detail: 'Was Feedback. The logo goes there too.',
    })
  })

  it('says which pages leave or join the menu, and that a hidden one stays open', () => {
    const { menu } = summary((draft) => {
      const roadmap = draft.nav.items.find((item) => item.type === 'roadmap')!
      if (roadmap.type !== 'link') roadmap.shown = false
    })
    expect(menu).toEqual([
      { kind: 'Menu', title: 'Roadmap out of the menu', detail: 'Still open at /roadmap' },
    ])
  })

  it('says when the menu’s order or names change', () => {
    const { menu } = summary((draft) => {
      draft.nav.items.reverse()
      const first = draft.nav.items.find((item) => item.type === 'feedback')!
      first.label = 'Ideas'
    })
    expect(menu.map((row) => row.title)).toEqual(
      expect.arrayContaining(['Menu order changed', 'Feedback renamed Ideas'])
    )
  })

  it('puts menu and landing first, and groups the rest by the part they change', () => {
    const result = summary((draft) => {
      draft.brand.light.accent = '#225544'
      draft.pages.home.headline = { title: { en: 'Hello' }, subtitle: {} }
      const roadmap = draft.nav.items.find((item) => item.type === 'roadmap')!
      if (roadmap.type !== 'link') roadmap.shown = false
    })
    expect(result.menu.map((row) => row.kind)).toEqual(['Menu'])
    expect(result.look.map((row) => row.kind)).toEqual(['Site styles', 'Hero'])
    expect(result.look[0]).toMatchObject({ title: 'Brand colour', detail: '1 change' })
  })

  it('says when Home joins or leaves the menu, or is renamed, while it stays on', () => {
    const live = defaultDesign()
    live.nav.home = { on: true, tab: true }
    const draft = structuredClone(live)
    draft.nav.home = { on: true, tab: false, label: 'Start' }
    const { menu } = publishSummary(live, draft, designChanges(live, draft), gates)
    expect(menu.map((row) => row.title)).toEqual(['Home out of the menu', 'Home renamed Start'])
    expect(menu[0]?.detail).toBe('Still open at /, where the logo goes')
  })

  it('says nothing of Home’s tab when Home itself turns on or off', () => {
    const { menu } = summary((draft) => {
      draft.nav.home = { on: true, tab: true }
    })
    expect(menu.map((row) => row.title)).not.toContain('Home in the menu')
  })

  it('has nothing to say about a design that did not change', () => {
    expect(summary(() => {})).toEqual({ menu: [], look: [], overrides: [] })
  })
})

describe('overrides in the publish summary', () => {
  const cta = { scope: 'part', part: 'hero.home.cta', element: 'button' } as const
  const feedback = { scope: 'page', page: 'feedback', element: 'button' } as const

  it('lists overrides added, changed and removed, apart from the rest of the look', () => {
    const live = defaultDesign()
    live.overrides = [
      { id: 'page:feedback:button', target: feedback, style: { base: { radius: 2 } } },
      {
        id: 'page:roadmap:postCard',
        target: { scope: 'page', page: 'roadmap', element: 'postCard' },
        style: { base: { radius: 2 } },
      },
    ]
    const draft = structuredClone(live)
    draft.overrides = [
      { id: 'page:feedback:button', target: feedback, style: { base: { radius: 6 } } },
      { id: 'part:hero.home.cta:button', target: cta, style: { base: { background: 'accent' } } },
    ]
    const result = publishSummary(live, draft, designChanges(live, draft), gates)
    expect(result.overrides).toEqual([
      { kind: 'Added', title: 'Call to action · Hero', detail: 'This one: background' },
      { kind: 'Changed', title: 'Main buttons on Feedback', detail: 'This page: corners' },
      { kind: 'Removed', title: 'Post cards on Roadmap' },
    ])
    expect(result.look.map((row) => row.kind)).not.toContain('Other')
  })

  it('notes an override whose part is gone, which nothing draws', () => {
    const { overrides } = summary((draft) => {
      draft.overrides = [
        {
          id: 'part:block.zzzzzzzz.heading:heading',
          target: { scope: 'part', part: 'block.zzzzzzzz.heading', element: 'heading' },
          style: { base: { size: 20 } },
        },
      ]
    })
    expect(overrides.at(-1)).toEqual({
      kind: 'Not drawn',
      title: 'Section headings in a block that is gone',
      detail: 'Its part is gone. Reset it in Theme, under Overrides.',
    })
  })
})
