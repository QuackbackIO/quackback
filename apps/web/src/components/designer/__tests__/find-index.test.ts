/**
 * Quick find's index is generated from what draws the rows: Theme's
 * sections, every element and each of its properties, the part panels, the
 * page's own panel and the block registry. Each entry reads as a path
 * ("Theme › Style › Corners"), never a raw id, and a search such as
 * "button colour" finds the element rows that answer it.
 */
import { describe, expect, it } from 'vitest'
import { newBlock } from '@/lib/shared/design/home'
import { outlineOf, type DesignerPage } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { STYLE_ELEMENTS } from '@/lib/shared/design/style-tokens'
import {
  blockFindActions,
  elementFindItems,
  findIndex,
  findPath,
  findScore,
  type FindItem,
} from '../find-index'
import { stylesElements } from '../styles-panel'

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const PAGES: DesignerPage[] = ['home', 'feedback', 'roadmap', 'changelog', 'help', 'support']

function index(page: DesignerPage = 'roadmap', design: PortalDesign = defaultDesign()) {
  return findIndex({
    design,
    gates: ALL_ON,
    nodes: outlineOf(design, page),
    page,
    pages: PAGES,
  })
}

const byPath = (items: FindItem[], path: string) => items.find((item) => findPath(item) === path)

/** The entries a search shows, best first, as the dialog orders them within a group. */
const search = (items: FindItem[], query: string) =>
  items
    .map((item) => ({ item, score: findScore(item, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => findPath(item))

describe('the paths quick find shows', () => {
  it('read as where each row is', () => {
    const items = index()
    for (const path of [
      'Theme › Style › Corners',
      'Theme › Colours › Brand colour',
      'Theme › Fonts › Body font',
      'Theme › Site images › Favicon',
      'Theme › Advanced › Custom CSS',
      'Elements › Main buttons › Background',
      'Elements › Post cards › Density',
      'Elements › Tabs and filters › Corners',
      'Elements › Main buttons › Edge › Width',
      'Logo › Height',
      'Hero › Layout › Height',
      'Feed › Posts › Sort',
      'Composer › Words › Prompt',
      'Roadmap › Title',
    ])
      expect(byPath(items, path), path).toBeDefined()
  })

  it('never show a raw id', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = [{ ...newBlock('ideas'), id: 'ideas0001' }]
    for (const item of index('home', doc)) {
      const path = findPath(item)
      expect(path, item.id).not.toMatch(/site:|block-|link:|[a-z][A-Z]|_/)
      expect(item.label.trim(), item.id).not.toBe('')
    }
  })

  it('give each entry its own id', () => {
    const items = index('feedback')
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })

  it('leave out labels no panel draws any more', () => {
    const labels = index().map((item) => item.label)
    for (const gone of ['Menu and buttons in capitals', 'Headlines', 'Exact values'])
      expect(labels).not.toContain(gone)
  })
})

describe('element properties in quick find', () => {
  it('index every property of every element Theme lists', () => {
    const items = index()
    for (const element of stylesElements(ALL_ON)) {
      const name = STYLE_ELEMENTS[element].label
      const rows = items.filter(
        (item) => item.path.slice(0, 2).join(' › ') === `Elements › ${name}`
      )
      expect(rows.length, name).toBeGreaterThan(0)
      expect(
        rows.every((item) => item.target.kind === 'row'),
        name
      ).toBe(true)
    }
  })

  it('open Theme at the element, in the state the row shows in', () => {
    const items = index()
    expect(byPath(items, 'Elements › Main buttons › Background')?.target).toEqual({
      kind: 'row',
      place: { kind: 'theme', at: { element: 'button', state: 'base' } },
      row: 'element-button-background',
    })
  })

  it('find "button colour", "card shadow" and "tab corners"', () => {
    const items = index()
    const colour = search(items, 'button colour').slice(0, 6)
    expect(colour).toContain('Elements › Main buttons › Background')
    expect(colour).toContain('Elements › Main buttons › Text colour')
    expect(search(items, 'button color').slice(0, 6)).toContain(
      'Elements › Main buttons › Background'
    )
    expect(search(items, 'card shadow').slice(0, 2)).toContain('Elements › Post cards › Shadow')
    expect(search(items, 'tab corners')[0]).toBe('Elements › Tabs and filters › Corners')
  })

  it('put a label that starts with the search first', () => {
    const items = index()
    expect(search(items, 'corners')[0]).toBe('Theme › Style › Corners')
    expect(search(items, 'favicon')[0]).toBe('Theme › Site images › Favicon')
  })

  it('find nothing for words that match nothing', () => {
    expect(search(index(), 'zebra crossing')).toEqual([])
  })
})

describe('part settings in quick find', () => {
  it('lead to the part on a page that has it', () => {
    const items = index('roadmap')
    expect(byPath(items, 'Feed › Posts › Sort')?.target).toEqual({
      kind: 'row',
      place: { kind: 'part', selection: 'feed', page: 'feedback' },
      row: 'feed-sort',
    })
    expect(byPath(items, 'Hero › Layout › Height')?.target).toEqual({
      kind: 'row',
      place: { kind: 'part', selection: 'hero', page: 'roadmap' },
      row: 'hero-height',
    })
  })

  it('lead Theme’s rows to Theme, Custom CSS opening Advanced first', () => {
    const items = index()
    expect(byPath(items, 'Theme › Style › Corners')?.target).toEqual({
      kind: 'row',
      place: { kind: 'theme', at: { element: null } },
      row: 'theme-corners',
    })
    expect(byPath(items, 'Theme › Advanced › Custom CSS')?.target).toMatchObject({
      opens: 'theme-advanced',
    })
  })

  it('offer a row only where its panel draws it', () => {
    const plain = defaultDesign()
    plain.layout.band = 'none'
    plain.layout.header = 'stacked'
    const labels = index('roadmap', plain).map(findPath)
    expect(labels).not.toContain('Header and menu › Layout › Blend into hero')
    expect(labels).not.toContain('Header and menu › Layout › Menu position')
    const banded = defaultDesign()
    banded.layout.band = 'brand'
    banded.layout.header = 'inline'
    const more = index('roadmap', banded).map(findPath)
    expect(more).toContain('Header and menu › Layout › Blend into hero')
    expect(more).toContain('Header and menu › Layout › Menu position')
  })

  it('take the hero’s main action to Home', () => {
    const items = index('roadmap')
    expect(byPath(items, 'Hero › Main action › Main action')?.target).toMatchObject({
      place: { kind: 'part', selection: 'hero', page: 'home' },
    })
  })

  it('put the page’s own rows on a page that has them', () => {
    const items = index('roadmap')
    expect(byPath(items, 'Changelog › Subscribe')?.target).toEqual({
      kind: 'row',
      place: { kind: 'part', selection: null, page: 'changelog' },
      row: 'page-subscribe',
    })
    expect(byPath(items, 'Roadmap › Background')?.target).toEqual({
      kind: 'row',
      place: { kind: 'part', selection: null, page: 'roadmap' },
      row: 'page-background',
    })
  })
})

describe('Home blocks’ and page sections’ settings', () => {
  const home = () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = [
      { ...newBlock('ideas'), id: 'ideas0001' },
      { ...newBlock('status', { y: 1 }), id: 'status001' },
    ]
    return doc
  }

  it('come from the block registry, under the page and the block', () => {
    const items = index('feedback', home())
    expect(byPath(items, 'Home › Top posts › How many')?.target).toEqual({
      kind: 'row',
      place: { kind: 'part', selection: 'block-ideas0001', page: 'home' },
      row: 'block-field-count',
    })
    expect(byPath(items, 'Home › Status › Background')).toBeDefined()
    expect(byPath(items, 'Home › Top posts › How many')?.icon).toBe('ideas')
  })

  it('show each block of the page with its icon', () => {
    const items = index('home', home())
    expect(items.find((item) => item.group === 'Blocks' && item.label === 'Top posts')?.icon).toBe(
      'ideas'
    )
  })
})

describe('the picked element’s rows', () => {
  it('are found in the panel open, by each row’s label', () => {
    const items = elementFindItems('button', 'Call to action')
    expect(items.find((item) => item.label === 'Width')?.path).toEqual(['Call to action', 'Edge'])
    expect(items.find((item) => item.label === 'Background')).toEqual({
      id: 'here:element-button-background',
      group: 'Settings',
      label: 'Background',
      path: ['Call to action'],
      aka: 'colour fill',
      terms: 'background colour color fill',
      target: { kind: 'row', place: { kind: 'here' }, row: 'element-button-background' },
    })
  })
})

describe('actions in quick find', () => {
  const run = () => {}
  it('add a block and start Home from a layout, whatever is picked', () => {
    const labels = blockFindActions({ picked: null, onAdd: run, onLayouts: run }).map(
      (item) => item.label
    )
    expect(labels).toEqual(['Add a block…', 'Start Home from a layout…'])
  })

  it('duplicate and remove the picked block, by its name', () => {
    const items = blockFindActions({
      picked: 'Top posts',
      onAdd: run,
      onLayouts: run,
      onDuplicate: run,
      onRemove: run,
    })
    expect(items.map((item) => item.label)).toEqual([
      'Add a block…',
      'Duplicate Top posts',
      'Remove Top posts',
      'Start Home from a layout…',
    ])
    expect(items.every((item) => item.group === 'Actions' && item.target.kind === 'action')).toBe(
      true
    )
  })
})
