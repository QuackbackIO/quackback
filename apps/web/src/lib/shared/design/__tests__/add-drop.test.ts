/**
 * Dragging a block from Add onto the page: the cell a new block of its usual
 * size lands on under the pointer, the block put there with the others moved
 * aside as moving does, what is said, and when a drop is refused.
 */
import { describe, expect, it } from 'vitest'
import { addDropRefusal, addedWords, dropCell } from '../add-drop'
import type { GridMetrics } from '../grid-geometry'
import { HOME_BLOCKS_MAX, insertHomeBlockAt, newBlock } from '../home'
import type { PortalPageGates } from '../paths'
import { defaultDesign, type PortalDesign } from '../schema'

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  status: true,
  support: true,
}

// Twelve columns of 60 with 20 between, from (100, 50); rows of 24 with 16 between.
const grid: GridMetrics = {
  left: 100,
  top: 50,
  width: 940,
  columns: 12,
  columnGap: 20,
  rowGap: 16,
  rows: [24, 24, 24, 24],
  unit: 24,
}

function home(): PortalDesign {
  const design = defaultDesign()
  design.pages.home.blocks = [
    { ...newBlock('welcome', { x: 0, y: 0, w: 12, h: 1 }), id: 'welcome01' },
    { ...newBlock('ideas', { x: 0, y: 1, w: 6, h: 2 }), id: 'ideas0001' },
    { ...newBlock('updates', { x: 6, y: 1, w: 6, h: 2 }), id: 'updates01' },
  ]
  return design
}

const placeOf = (design: PortalDesign, id: string) =>
  design.pages.home.blocks.find((block) => block.id === id)!.grid

describe('the cell a new block lands on', () => {
  it('centres the block’s usual width on the pointer, its top at the pointer’s row', () => {
    // Status is 4 columns (300 wide): centred on x 730 its left is 480 into the grid, column 6.
    expect(dropCell(grid, 'status', { x: 730, y: 52 })).toEqual({ x: 6, y: 0 })
    expect(dropCell(grid, 'status', { x: 730, y: 140 })).toEqual({ x: 6, y: 2 })
  })

  it('keeps a wide block inside the grid', () => {
    expect(dropCell(grid, 'roadmap', { x: 1000, y: 60 })).toEqual({ x: 0, y: 0 })
    expect(dropCell(grid, 'ideas', { x: 1030, y: 60 })).toEqual({ x: 6, y: 0 })
  })
})

describe('a block put on Home at a cell', () => {
  it('lands where dropped at its usual size, and the blocks in its way move down', () => {
    const design = home()
    const block = { ...newBlock('status'), id: 'status001' }
    const place = insertHomeBlockAt(design, ALL_ON, block, { x: 0, y: 1 })
    expect(place).toEqual({ x: 0, y: 1, w: 4, h: 1 })
    expect(placeOf(design, 'status001')).toEqual({ x: 0, y: 1, w: 4, h: 1 })
    expect(placeOf(design, 'ideas0001').y).toBe(2)
    expect(placeOf(design, 'welcome01')).toEqual({ x: 0, y: 0, w: 12, h: 1 })
    // Reading order: the list of blocks follows the page.
    expect(design.pages.home.blocks.map((one) => one.id)).toEqual([
      'welcome01',
      'status001',
      'updates01',
      'ideas0001',
    ])
  })

  it('floats up to fill a gap, as every block does', () => {
    const design = home()
    const place = insertHomeBlockAt(
      design,
      ALL_ON,
      { ...newBlock('links'), id: 'links0001' },
      {
        x: 0,
        y: 20,
      }
    )
    expect(place).toEqual({ x: 0, y: 3, w: 4, h: 1 })
  })
})

describe('when a drop is refused', () => {
  const at = { page: 'home' as const, columns: 12 }

  it('takes blocks on Home only', () => {
    expect(addDropRefusal(home(), ALL_ON, 'status', { ...at, page: 'roadmap' })).toBe(
      'Goes on Home. Click it to add it there.'
    )
  })

  it('takes them in the desktop view, where the grid has its twelve columns', () => {
    expect(addDropRefusal(home(), ALL_ON, 'status', { ...at, columns: 2 })).toBe(
      'Drop blocks in the desktop view.'
    )
  })

  it('refuses a second of a block Home holds once, and any once Home is full', () => {
    const design = home()
    expect(addDropRefusal(design, ALL_ON, 'updates', at)).toBe('Latest updates is on Home already.')
    expect(addDropRefusal(design, ALL_ON, 'ideas', at)).toBeNull()
    design.pages.home.blocks = Array.from({ length: HOME_BLOCKS_MAX }, () => newBlock('links'))
    expect(addDropRefusal(design, ALL_ON, 'links', at)).toBe(
      `Home holds ${HOME_BLOCKS_MAX} blocks.`
    )
  })

  it('refuses a block for a part that is off', () => {
    expect(addDropRefusal(home(), { ...ALL_ON, status: false }, 'status', at)).toBe(
      'Turn on Status to add this block.'
    )
  })
})

describe('what is said', () => {
  it('names the block and where it went, counting from one', () => {
    expect(addedWords('Status', { x: 6, y: 1 })).toBe('Status added at row 2, column 7.')
  })
})
