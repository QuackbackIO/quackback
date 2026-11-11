/**
 * The page's parts as a tree for the right panel: the header and its menu,
 * the hero and its elements, the blocks or the page's own parts, each row
 * with what it can do (hide, move).
 */
import { describe, expect, it } from 'vitest'
import { insertHomeBlock } from '../home'
import { outlineOf, type DesignerPage } from '../outline'
import type { PortalPageGates } from '../paths'
import { pageTree, setRowShown, treeRows, type TreeRow } from '../page-tree'
import { defaultDesign, type PortalDesign } from '../schema'

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

function tree(page: DesignerPage, change?: (draft: PortalDesign) => void) {
  const design = defaultDesign()
  change?.(design)
  return { design, rows: pageTree(design, gates, page, outlineOf(design, page)) }
}

const labels = (rows: readonly TreeRow[]) => rows.map((row) => row.label)
const find = (rows: readonly TreeRow[], id: string) => treeRows(rows).find((row) => row.id === id)

describe('pageTree', () => {
  it('leads with the header, its logo and menu items, then the hero, then the page’s parts', () => {
    const { rows } = tree('roadmap')
    expect(labels(rows)).toEqual(['Header and menu', 'Hero', 'Board'])
    const header = rows[0]!
    expect(header.children?.map((row) => [row.id, row.level])).toEqual([
      ['logo', 2],
      ['page:feedback', 2],
      ['page:roadmap', 2],
      ['page:changelog', 2],
      ['page:help', 2],
    ])
    expect(rows.every((row) => row.level === 1)).toBe(true)
  })

  it('lets menu items hide and move, but not the page visitors land on', () => {
    const { rows } = tree('roadmap')
    const feedback = find(rows, 'page:feedback')!
    // Feedback is where visitors land while Home is off: it stays.
    expect(feedback.hide).toEqual({ shown: true, locked: true })
    expect(feedback.move).toEqual({ up: false, down: true })
    expect(find(rows, 'page:roadmap')!.hide).toEqual({ shown: true, locked: false })
    expect(find(rows, 'page:help')!.move).toEqual({ up: true, down: false })
    expect(find(rows, 'logo')!.hide).toBeUndefined()
    expect(find(rows, 'logo')!.move).toBeUndefined()
  })

  it('shows a hidden menu item as hidden', () => {
    const { rows } = tree('roadmap', (draft) => {
      draft.nav.items = [
        { type: 'feedback', shown: true },
        { type: 'roadmap', shown: false },
      ]
    })
    expect(find(rows, 'page:roadmap')!.hide).toEqual({ shown: false, locked: false })
  })

  it('notes the composer block as shown in the hero while the hero has it', () => {
    const composerRow = (place: 'band' | undefined) => {
      const { rows } = tree('home', (draft) => {
        draft.nav.home.on = true
        draft.pages.home.blocks = [
          { type: 'composer', id: 'compose1', grid: { x: 0, y: 0, w: 12, h: 1 } } as never,
        ]
        draft.pages.home.composer = place
        delete draft.pages.home.mainAction
      })
      return treeRows(rows).find((row) => row.blockType === 'composer')!
    }
    expect(composerRow('band').note).toBe('Shown in the hero')
    expect(composerRow(undefined).note).toBeUndefined()
  })

  it('lists the hero’s elements under it, the image only when it has one', () => {
    const { rows } = tree('roadmap')
    const hero = rows.find((row) => row.id === 'hero')!
    expect(hero.children?.map((row) => [row.label, row.key, row.part])).toEqual([
      ['Headline', 'hero', 'hero.roadmap.headline'],
      ['Subtitle', 'hero', 'hero.roadmap.subtitle'],
    ])
    const withImage = tree('roadmap', (draft) => {
      draft.brand.heroImage = { key: 'band.png' }
    })
    expect(find(withImage.rows, 'hero')!.children?.map((row) => row.label)).toContain('Image')
  })

  it('lists Home’s blocks under Blocks, each moving up and down within them', () => {
    const { rows } = tree('home', (draft) => {
      draft.nav.home.on = true
      insertHomeBlock(draft, 'ideas')
      insertHomeBlock(draft, 'roadmap')
      insertHomeBlock(draft, 'updates')
    })
    const blocks = rows.find((row) => row.id === 'home')!
    expect(blocks.children).toHaveLength(3)
    expect(blocks.children!.map((row) => row.move)).toEqual([
      { up: false, down: true },
      { up: true, down: true },
      { up: true, down: false },
    ])
    expect(blocks.children!.every((row) => row.key.startsWith('block-'))).toBe(true)
    expect(blocks.children!.every((row) => row.hide === undefined)).toBe(true)
  })

  it('gives an eye to the parts a page can hide, from their own show fields', () => {
    const feedback = tree('feedback')
    expect(labels(feedback.rows)).toEqual([
      'Header and menu',
      'Hero',
      'Welcome message',
      'Composer',
      'Feed',
      'Filters',
    ])
    expect(find(feedback.rows, 'welcome')!.hide).toEqual({ shown: false, locked: false })
    expect(find(feedback.rows, 'composer')!.hide).toBeUndefined()
    const help = tree('help', (draft) => void (draft.pages.help = { popular: false }))
    expect(find(help.rows, 'popular')!.hide).toEqual({ shown: false, locked: false })
    expect(find(help.rows, 'popular')!.label).toBe('Popular articles')
  })
})

describe('setRowShown', () => {
  it('writes the welcome message’s and popular articles’ own show fields', () => {
    const design = defaultDesign()
    expect(setRowShown(design, 'welcome', true)).toBe(true)
    expect(design.pages.feedback.welcome.show).toBe(true)
    setRowShown(design, 'popular', false)
    expect(design.pages.help?.popular).toBe(false)
    setRowShown(design, 'popular', true)
    expect(design.pages.help?.popular).toBeUndefined()
    expect(setRowShown(design, 'composer', false)).toBe(false)
  })
})

describe('treeRows', () => {
  it('flattens the tree, children after their parent, or only the open rows', () => {
    const { rows } = tree('roadmap')
    expect(treeRows(rows).map((row) => row.id)).toEqual([
      'header',
      'logo',
      'page:feedback',
      'page:roadmap',
      'page:changelog',
      'page:help',
      'hero',
      'part:hero.roadmap.headline',
      'part:hero.roadmap.subtitle',
      'board',
    ])
    expect(treeRows(rows, new Set(['hero'])).map((row) => row.id)).toEqual([
      'header',
      'hero',
      'part:hero.roadmap.headline',
      'part:hero.roadmap.subtitle',
      'board',
    ])
  })
})
