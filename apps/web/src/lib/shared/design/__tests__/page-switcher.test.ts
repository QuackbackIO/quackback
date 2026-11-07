import { describe, expect, it } from 'vitest'
import { defaultDesign, type PortalDesign } from '../schema'
import type { PortalPageGates } from '../paths'
import {
  boardPath,
  NO_PLACES,
  switcherColumns,
  type DesignerPlaces,
  type SwitcherColumn,
} from '../page-switcher'

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

const places: DesignerPlaces = {
  boards: [
    { id: 'b1', name: 'Feature requests', slug: 'features' },
    { id: 'b2', name: 'Bugs', slug: 'bugs' },
  ],
  roadmaps: [
    { id: 'r1', name: 'Product roadmap' },
    { id: 'r2', name: 'Mobile roadmap' },
  ],
  categories: [{ id: 'c1', name: 'Getting started', path: '/hc/en/collections/1-getting-started' }],
  posts: [{ id: 'p1', title: 'Dark mode', path: '/b/features/posts/p1' }],
  entries: [{ id: 'e1', title: 'Seed calendar', path: '/changelog/e1' }],
  articles: [{ id: 'a1', title: 'First bed', path: '/hc/en/articles/1-first-bed' }],
}

function design(change?: (draft: PortalDesign) => void) {
  const draft = defaultDesign()
  draft.nav.home = { on: true, tab: true }
  change?.(draft)
  return draft
}

const columns = (options: Partial<Parameters<typeof switcherColumns>[0]> = {}): SwitcherColumn[] =>
  switcherColumns({
    design: design(),
    gates,
    places,
    here: { page: 'home', item: null },
    sample: null,
    ...options,
  })

const column = (all: SwitcherColumn[], key: string) => all.find((each) => each.key === key)!
const rows = (each: SwitcherColumn) => each.rows.map((row) => row.label)

describe('the page switcher, by module', () => {
  it('has a column for each part that is on, then those turned off', () => {
    expect(columns().map((each) => each.title)).toEqual([
      'General',
      'Feedback',
      'Roadmap',
      'Changelog',
      'Help center',
      'Turned off',
    ])
  })

  it('leaves out a part that is off, and Turned off when every part is on', () => {
    const all = columns({ gates: { ...gates, support: true, status: true } })
    expect(all.map((each) => each.key)).toEqual([
      'general',
      'feedback',
      'roadmap',
      'changelog',
      'help',
      'support',
      'status',
    ])
    const fewer = columns({ gates: { ...gates, changelog: false } })
    expect(fewer.map((each) => each.key)).not.toContain('changelog')
    expect(rows(column(fewer, 'off'))).toContain('Changelog')
  })

  it('says how each part shows in the menu', () => {
    const renamed = design((draft) => {
      const item = draft.nav.items.find((each) => each.type === 'changelog')!
      if ('shown' in item) item.label = 'What is new'
      const roadmap = draft.nav.items.find((each) => each.type === 'roadmap')!
      if ('shown' in roadmap) roadmap.shown = false
    })
    const all = columns({ design: renamed })
    expect(column(all, 'general').note).toBe('')
    expect(column(all, 'feedback').note).toBe('In the menu as "Feedback"')
    expect(column(all, 'changelog').note).toBe('In the menu as "What is new"')
    expect(column(all, 'roadmap').note).toBe('Hidden')
    expect(column(all, 'off').note).toBe('Samples until you turn them on')
  })

  it('lists Home, the landing page, leaving out what is still to come', () => {
    const general = column(columns({ here: { page: 'roadmap', item: null } }), 'general')
    expect(general.rows.map((row) => [row.label, row.hint, row.go.kind])).toEqual([
      ['Home', 'Landing page', 'page'],
    ])
  })

  it('leaves Home out while it is off, and marks the page visitors land on', () => {
    const off = design((draft) => {
      draft.nav.home = { on: false, tab: false }
    })
    const all = columns({ design: off, here: { page: 'roadmap', item: null } })
    expect(rows(column(all, 'general'))).not.toContain('Home')
    expect(column(all, 'feedback').rows[0]).toMatchObject({
      label: 'All boards',
      hint: 'Landing page',
    })
  })

  it('lists every board under All boards, and a post to choose', () => {
    const feedback = column(columns(), 'feedback')
    expect(feedback.rows.map((row) => [row.label, !!row.indent])).toEqual([
      ['All boards', false],
      ['Feature requests', true],
      ['Bugs', true],
      ['A post', false],
    ])
    expect(feedback.rows[1]!.go).toEqual({
      kind: 'page',
      page: 'feedback',
      item: '/feedback?board=features',
    })
    expect(feedback.rows[3]).toMatchObject({
      hint: 'Choose one',
      go: { kind: 'choose', list: 'posts' },
    })
  })

  it('lists each roadmap, the changelog and an entry, help home, topics and an article', () => {
    const all = columns()
    expect(rows(column(all, 'roadmap'))).toEqual(['Product roadmap', 'Mobile roadmap'])
    expect(column(all, 'roadmap').rows[1]!.go).toEqual({
      kind: 'page',
      page: 'roadmap',
      item: '/roadmap?roadmap=r2',
    })
    expect(rows(column(all, 'changelog'))).toEqual(['Changelog', 'An entry'])
    expect(rows(column(all, 'help'))).toEqual(['Help home', 'Getting started', 'An article'])
    expect(column(all, 'help').rows[1]).toMatchObject({ indent: true })
  })

  it('shows the roadmap page itself when there are no roadmaps to list', () => {
    const all = columns({ places: NO_PLACES })
    expect(column(all, 'roadmap').rows.map((row) => [row.label, row.go])).toEqual([
      ['Roadmap', { kind: 'page', page: 'roadmap', item: null }],
    ])
  })

  it('ticks the page shown, by its item too', () => {
    const current = (all: SwitcherColumn[]) =>
      all.flatMap((each) => each.rows.filter((row) => row.current).map((row) => row.label))
    expect(current(columns({ here: { page: 'changelog', item: null } }))).toEqual(['Changelog'])
    expect(current(columns({ here: { page: 'feedback', item: '/feedback?board=bugs' } }))).toEqual([
      'Bugs',
    ])
    expect(current(columns({ here: { page: 'post', item: '/b/features/posts/p1' } }))).toEqual([
      'A post',
    ])
    // The first roadmap is what the roadmap page shows by itself.
    expect(current(columns({ here: { page: 'roadmap', item: null } }))).toEqual(['Product roadmap'])
    expect(current(columns({ here: { page: 'roadmap', item: null }, sample: 'support' }))).toEqual([
      'Support',
    ])
  })

  it('says You are here on the page shown', () => {
    const changelog = column(columns({ here: { page: 'changelog', item: null } }), 'changelog')
    expect(changelog.rows[0]).toMatchObject({ current: true, hint: 'You are here' })
  })

  it('offers the parts turned off as samples, and a way to turn one on', () => {
    const off = column(columns(), 'off')
    expect(off.rows.map((row) => [row.label, row.hint, row.go])).toEqual([
      ['Support', 'Sample', { kind: 'sample', page: 'support' }],
      ['Status', 'Sample', { kind: 'sample', page: 'status' }],
      ['Turn one on', undefined, { kind: 'turn-on' }],
    ])
  })

  it('finds a page by its module and its name in the menu', () => {
    const renamed = design((draft) => {
      const item = draft.nav.items.find((each) => each.type === 'changelog')!
      if ('shown' in item) item.label = 'What is new'
    })
    const entry = column(columns({ design: renamed }), 'changelog').rows[0]!
    expect(entry.label).toBe('What is new')
    expect(entry.keywords).toEqual(expect.arrayContaining(['Changelog', 'What is new']))
  })
})

describe('a board address', () => {
  it('goes to the feed where it is, filtered to the board', () => {
    expect(boardPath('/feedback', 'bugs')).toBe('/feedback?board=bugs')
    expect(boardPath('/', 'my board')).toBe('/?board=my%20board')
  })
})
