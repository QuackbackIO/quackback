/**
 * Home layouts never leave a hole: every row Home draws is filled across
 * its twelve columns, whichever pages are on and whether the composer sits
 * in the band (where its grid place draws nothing), and a half-width block
 * is paired with the next one rather than stretched alone across the page.
 */
import { describe, expect, it } from 'vitest'
import { arrangeHome, HOME_LAYOUTS, type HomeLayout } from '../home-layouts'
import { homeGridItems, newBlock, starterHomeBlocks } from '../home'
import { settle, readingOrder, GRID_COLUMNS, type GridItem } from '../home-grid'
import type { HomeBlock } from '../home'
import type { PortalPageGates } from '../paths'
import type { PortalDesign } from '../schema'

const PAGES = ['feedback', 'roadmap', 'changelog', 'help', 'support', 'status'] as const
const ALL_ON = Object.fromEntries(PAGES.map((p) => [p, true])) as PortalPageGates

/** Every combination of pages on and off. */
const everyGates: PortalPageGates[] = Array.from(
  { length: 1 << PAGES.length },
  (_, bits) => Object.fromEntries(PAGES.map((p, i) => [p, !!(bits & (1 << i))])) as PortalPageGates
)

/** The portal's own arrangement, as a brand match uses it. */
const PORTAL: HomeLayout = {
  id: 'portal',
  label: 'Portal',
  description: '',
  blocks: [
    ['composer', 12],
    ['contact', 12],
    ['ideas', 6],
    ['updates', 6],
    ['roadmap', 12],
    ['help_search', 12],
    ['help_topics', 12],
  ],
}
const LAYOUTS = [...HOME_LAYOUTS, PORTAL]

/** Home's drawn blocks, laid out as the portal lays them out, grouped by row. */
function drawnRows(blocks: HomeBlock[], gates: PortalPageGates, band: boolean): GridItem[][] {
  const home = { blocks, ...(band ? { composer: 'band' } : {}) } as PortalDesign['pages']['home']
  const rows = new Map<number, GridItem[]>()
  for (const item of readingOrder(settle(homeGridItems(home, gates)))) {
    rows.set(item.y, [...(rows.get(item.y) ?? []), item])
  }
  return [...rows.values()]
}

describe('arrangeHome', () => {
  it('fills every drawn row, for every layout, every set of pages, composer in the band or not', () => {
    for (const layout of LAYOUTS)
      for (const gates of everyGates)
        for (const band of [false, true]) {
          const blocks = arrangeHome(starterHomeBlocks(ALL_ON), layout, gates, { band })
          for (const row of drawnRows(blocks, gates, band)) {
            const used = row.reduce((sum, item) => sum + item.w, 0)
            expect(
              used,
              `${layout.id} ${JSON.stringify(gates)} band=${band}: ${JSON.stringify(row)}`
            ).toBe(GRID_COLUMNS)
          }
        }
  })

  it('leaves no hole where the composer moved into the band (Roadmap and updates, Status off)', () => {
    const gates = { ...ALL_ON, status: false }
    const layout = HOME_LAYOUTS.find((l) => l.id === 'roadmap')!
    const blocks = arrangeHome(starterHomeBlocks(ALL_ON), layout, gates, { band: true })
    const rows = drawnRows(blocks, gates, true).map((row) =>
      row.map((item) => {
        const block = blocks.find((b) => b.id === item.id)!
        return `${block.type}:${item.w}`
      })
    )
    expect(rows.slice(0, 2)).toEqual([['roadmap:12'], ['updates:6', 'ideas:6']])
  })

  it('puts the composer that sits in the band first, across the page, so it is first again if taken out', () => {
    const layout = HOME_LAYOUTS.find((l) => l.id === 'roadmap')!
    const blocks = arrangeHome(starterHomeBlocks(ALL_ON), layout, ALL_ON, { band: true })
    expect(blocks[0]).toMatchObject({ type: 'composer', grid: { x: 0, y: 0, w: 12 } })
  })

  it('pairs half-width blocks rather than stretching one alone across the page', () => {
    for (const layout of LAYOUTS)
      for (const gates of everyGates)
        for (const band of [false, true]) {
          const blocks = arrangeHome(starterHomeBlocks(ALL_ON), layout, gates, { band })
          const rows = drawnRows(blocks, gates, band)
          const loneHalves = rows.map(
            (row) =>
              row.length === 1 &&
              (layout.blocks.find(
                ([t]) => t === blocks.find((b) => b.id === row[0]!.id)!.type
              )?.[1] ?? 12) < 12
          )
          for (let i = 1; i < loneHalves.length; i++)
            expect(
              loneHalves[i - 1] && loneHalves[i],
              `${layout.id} ${JSON.stringify(gates)} band=${band}`
            ).toBe(false)
        }
  })

  it('keeps a block the layout does not name, below, without a hole among the drawn ones', () => {
    const blocks = [...starterHomeBlocks(ALL_ON), newBlock('links'), newBlock('status')]
    const gates = { ...ALL_ON, status: false }
    const out = arrangeHome(blocks, HOME_LAYOUTS[0]!, gates, { band: true })
    expect(out.map((b) => b.type)).toContain('links')
    for (const row of drawnRows(out, gates, true))
      expect(row.reduce((sum, item) => sum + item.w, 0)).toBe(GRID_COLUMNS)
  })
})
