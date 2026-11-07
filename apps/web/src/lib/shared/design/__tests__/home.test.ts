/**
 * Home's starter layout: Welcome, then Share an idea with Status, Top ideas
 * with Latest updates, the roadmap and help topics, skipping any whose page
 * is off, each on the grid. Blocks move, are added and are copied on the
 * grid, and the list of blocks keeps reading order.
 */
import { describe, expect, it } from 'vitest'
import {
  blockPageOff,
  duplicateHomeBlock,
  HOME_BLOCKS_MAX,
  insertHomeBlock,
  moveHomeBlock,
  newBlock,
  placeHomeBlock,
  homeGridItems,
  starterHomeBlocks,
  withBlockIds,
} from '../home'
import { BLOCK_ID, portalDesign, defaultDesign, type PortalDesign } from '../schema'
import { DESIGN_OPTIONS } from '../options'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

describe('starterHomeBlocks', () => {
  it('lays out every page the workspace has', () => {
    const placed = starterHomeBlocks(ALL_ON).map(({ type, grid: { x, y, w, h } }) => [
      type,
      [x, y, w, h],
    ])
    // A row each, as tall as the content in it.
    expect(placed).toEqual([
      ['welcome', [0, 0, 12, 1]],
      ['composer', [0, 1, 8, 1]],
      ['status', [8, 1, 4, 1]],
      ['ideas', [0, 2, 6, 1]],
      ['updates', [6, 2, 6, 1]],
      ['roadmap', [0, 3, 12, 1]],
      ['help_topics', [0, 4, 12, 1]],
    ])
  })

  it('lets a block whose neighbour is off take its row', () => {
    const composer = starterHomeBlocks({ ...ALL_ON, status: false })[1]!
    expect(composer.grid).toEqual({ x: 0, y: 1, w: 12, h: 1 })
  })

  it('skips the blocks whose pages are off', () => {
    const types = starterHomeBlocks({
      ...ALL_ON,
      status: false,
      changelog: false,
      help: false,
    }).map((block) => block.type)
    expect(types).toEqual(['welcome', 'composer', 'ideas', 'roadmap'])
  })

  const layout = (lead: Parameters<typeof starterHomeBlocks>[1]) =>
    starterHomeBlocks(ALL_ON, lead).map((block) => block.type)

  it('lets the part first in the menu lead: its row comes first, its block first in the row', () => {
    expect(layout('feedback')).toEqual(layout(undefined))
    expect(layout('help')).toEqual([
      'welcome',
      'help_topics',
      'composer',
      'status',
      'ideas',
      'updates',
      'roadmap',
    ])
    expect(layout('changelog')).toEqual([
      'welcome',
      'updates',
      'ideas',
      'composer',
      'status',
      'roadmap',
      'help_topics',
    ])
    expect(layout('status').slice(0, 3)).toEqual(['welcome', 'status', 'composer'])
    expect(layout('roadmap').slice(0, 2)).toEqual(['welcome', 'roadmap'])
  })

  it('keeps the usual order when the leading part has no block of its own', () => {
    expect(layout('support')).toEqual(layout(undefined))
  })

  it('makes a valid design', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = starterHomeBlocks(ALL_ON)
    expect(portalDesign.safeParse(doc).success).toBe(true)
  })
})

describe('newBlock', () => {
  it('makes every block type valid at its usual size', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = DESIGN_OPTIONS.blockType.map((type) => newBlock(type))
    expect(portalDesign.safeParse(doc).success).toBe(true)
  })
})

describe('block ids', () => {
  const design = (blocks: unknown[]) =>
    ({
      ...defaultDesign(),
      pages: { ...defaultDesign().pages, home: { headline: null, blocks } },
    }) as PortalDesign

  it('names blocks without ids by their type and place, the same way every time', () => {
    const doc = design([
      { type: 'ideas', width: 'half', sort: 'trending', count: 3 },
      { type: 'help_topics', width: 'full', categoryIds: [] },
      { type: 'ideas', width: 'half', sort: 'top', count: 3 },
    ])
    const ids = withBlockIds(doc).pages.home.blocks.map((b) => b.id)
    expect(ids).toEqual(['ideas001', 'helptopics001', 'ideas002'])
    expect(withBlockIds(doc).pages.home.blocks.map((b) => b.id)).toEqual(ids)
  })

  it('keeps ids blocks have, and renames one that repeats where it repeats', () => {
    const doc = design([
      { id: 'keepthis01', type: 'composer', width: 'full' },
      { id: 'keepthis01', type: 'status', width: 'third' },
      { type: 'contact', width: 'third' },
    ])
    expect(withBlockIds(doc).pages.home.blocks.map((b) => b.id)).toEqual([
      'keepthis01',
      'status001',
      'contact001',
    ])
  })

  it('gives each new block an id of its own', () => {
    const a = newBlock('ideas')
    const b = newBlock('ideas')
    expect(a.id).toMatch(BLOCK_ID)
    expect(a.id).not.toBe(b.id)
  })
})

/** Three status blocks, one under another. */
function stacked() {
  const doc = defaultDesign()
  doc.pages.home.blocks = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'].map((id, i) => ({
    ...newBlock('status', { x: 0, y: i * 4 }),
    id,
  }))
  return doc
}
const ids = (doc: PortalDesign) => doc.pages.home.blocks.map((block) => block.id)
const placeOf = (doc: PortalDesign, id: string) => {
  const { x, y, w, h } = doc.pages.home.blocks.find((block) => block.id === id)!.grid
  return [x, y, w, h]
}

describe('moveHomeBlock', () => {
  it('swaps places with the block before or after it in reading order, by its id', () => {
    const doc = stacked()
    moveHomeBlock(doc, 'bbbbbbbb', -1)
    expect(ids(doc)).toEqual(['bbbbbbbb', 'aaaaaaaa', 'cccccccc'])
    expect(placeOf(doc, 'bbbbbbbb')).toEqual([0, 0, 4, 1])
    moveHomeBlock(doc, 'aaaaaaaa', 1)
    expect(ids(doc)).toEqual(['bbbbbbbb', 'cccccccc', 'aaaaaaaa'])
  })

  it('swaps blocks side by side, each keeping its size', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = [
      { ...newBlock('ideas', { x: 0, y: 0, w: 8 }), id: 'ideas0001' },
      { ...newBlock('status', { x: 8, y: 0 }), id: 'status001' },
    ]
    moveHomeBlock(doc, 'status001', -1)
    expect(ids(doc)).toEqual(['status001', 'ideas0001'])
    expect(placeOf(doc, 'status001')).toEqual([0, 0, 4, 1])
    expect(placeOf(doc, 'ideas0001')).toEqual([4, 0, 8, 1])
  })

  it('leaves the blocks be at an end, or for an id it does not know', () => {
    const doc = stacked()
    moveHomeBlock(doc, 'aaaaaaaa', -1)
    moveHomeBlock(doc, 'cccccccc', 1)
    moveHomeBlock(doc, 'zzzzzzzz', 1)
    expect(ids(doc)).toEqual(['aaaaaaaa', 'bbbbbbbb', 'cccccccc'])
  })
})

describe('placeHomeBlock and insertHomeBlock', () => {
  it('drops a block between two others, wherever it came from', () => {
    const doc = stacked()
    placeHomeBlock(doc, 'aaaaaaaa', 2)
    expect(ids(doc)).toEqual(['bbbbbbbb', 'aaaaaaaa', 'cccccccc'])
    placeHomeBlock(doc, 'cccccccc', 0)
    expect(ids(doc)).toEqual(['cccccccc', 'bbbbbbbb', 'aaaaaaaa'])
    placeHomeBlock(doc, 'cccccccc', 3)
    expect(ids(doc)).toEqual(['bbbbbbbb', 'aaaaaaaa', 'cccccccc'])
    placeHomeBlock(doc, 'zzzzzzzz', 0)
    expect(ids(doc)).toEqual(['bbbbbbbb', 'aaaaaaaa', 'cccccccc'])
  })

  it('adds a new block under the one named, pushing the rest down, or under them all', () => {
    const doc = stacked()
    const under = insertHomeBlock(doc, 'links', 'aaaaaaaa')
    const last = insertHomeBlock(doc, 'contact')
    expect(ids(doc)).toEqual(['aaaaaaaa', under.id, 'bbbbbbbb', 'cccccccc', last.id])
    expect(placeOf(doc, under.id!)).toEqual([0, 1, 4, 1])
    expect(placeOf(doc, 'bbbbbbbb')).toEqual([0, 2, 4, 1])
    expect(placeOf(doc, last.id!)).toEqual([0, 4, 4, 1])
  })
})

describe('duplicateHomeBlock', () => {
  it('puts a copy with its own id under the block, and nothing once Home is full', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [newBlock('welcome'), newBlock('links', { y: 3 })]
    const [welcome] = design.pages.home.blocks
    const copy = duplicateHomeBlock(design, welcome!.id!)
    expect(design.pages.home.blocks.map((block) => block.type)).toEqual([
      'welcome',
      'welcome',
      'links',
    ])
    expect(copy?.id).not.toBe(welcome!.id)
    expect(design.pages.home.blocks[1]).toEqual({
      ...welcome,
      id: copy!.id,
      grid: { ...welcome!.grid, y: 1 },
    })
    expect(design.pages.home.blocks[2]!.grid.y).toBe(2)
    design.pages.home.blocks = Array.from({ length: HOME_BLOCKS_MAX }, () => newBlock('links'))
    expect(duplicateHomeBlock(design, design.pages.home.blocks[0]!.id!)).toBeNull()
    expect(design.pages.home.blocks).toHaveLength(HOME_BLOCKS_MAX)
  })
})

describe('homeGridItems', () => {
  it('leaves out blocks whose page is off and the composer in the band', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = [
      { ...newBlock('composer'), id: 'composer1' },
      { ...newBlock('status', { y: 2 }), id: 'status001' },
      { ...newBlock('links', { y: 6 }), id: 'links0001' },
    ]
    doc.pages.home.composer = 'band'
    const shown = homeGridItems(doc.pages.home, { ...ALL_ON, status: false })
    expect(shown.map((item) => item.id)).toEqual(['links0001'])
  })

  it('lets the block beside the composer in the band take its columns, so the row has no hole', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = starterHomeBlocks(ALL_ON)
    doc.pages.home.composer = 'band'
    const status = doc.pages.home.blocks.find((b) => b.type === 'status')!
    const shown = homeGridItems(doc.pages.home, ALL_ON)
    expect(shown.find((item) => item.id === status.id)).toMatchObject({ x: 0, w: 12 })
    const ideas = doc.pages.home.blocks.find((b) => b.type === 'ideas')!
    expect(shown.find((item) => item.id === ideas.id)).toMatchObject({ w: ideas.grid.w })
  })

  it('lets the block beside one whose page is off take its columns', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = [
      { ...newBlock('ideas', { x: 0, y: 0, w: 6 }), id: 'ideas0001' },
      { ...newBlock('updates', { x: 6, y: 0, w: 6 }), id: 'updates01' },
      { ...newBlock('roadmap', { x: 0, y: 1, w: 12 }), id: 'roadmap01' },
    ]
    const shown = homeGridItems(doc.pages.home, { ...ALL_ON, changelog: false })
    expect(shown.map(({ id, x, w }) => [id, x, w])).toEqual([
      ['ideas0001', 0, 12],
      ['roadmap01', 0, 12],
    ])
  })

  it('leaves a row alone when nothing beside the left-out block shares its row exactly', () => {
    const doc = defaultDesign()
    doc.pages.home.blocks = [
      { ...newBlock('composer', { x: 0, y: 0, w: 6 }), id: 'composer1' },
      { ...newBlock('ideas', { x: 6, y: 0, w: 6, h: 3 }), id: 'ideas0001' },
    ]
    doc.pages.home.composer = 'band'
    expect(homeGridItems(doc.pages.home, ALL_ON)).toMatchObject([{ id: 'ideas0001', x: 6, w: 6 }])
  })
})

describe('the grid after a legacy read', () => {
  it('reads widths from before the grid as places, in their old order', () => {
    const doc = defaultDesign() as unknown as Record<string, unknown> & PortalDesign
    const home = {
      headline: null,
      blocks: [
        { type: 'welcome', width: 'full', body: { type: 'doc', content: [] } },
        { type: 'composer', width: 'two_thirds' },
        { type: 'status', width: 'third' },
        { type: 'ideas', width: 'half', sort: 'top', count: 5 },
        { type: 'updates', width: 'third', count: 3 },
        { type: 'contact', width: 'half' },
      ],
    }
    const parsed = portalDesign.parse({ ...doc, pages: { ...doc.pages, home } })
    expect(
      parsed.pages.home.blocks.map(({ type, grid: { x, y, w, h } }) => [type, x, y, w, h])
    ).toEqual([
      ['welcome', 0, 0, 12, 1],
      ['composer', 0, 1, 8, 1],
      ['status', 8, 1, 4, 1],
      // Half and third leave the row short, so the third reaches its end as it did.
      ['ideas', 0, 2, 6, 1],
      ['updates', 6, 2, 6, 1],
      ['contact', 0, 3, 12, 1],
    ])
    expect(parsed.pages.home.blocks.some((block) => 'width' in block)).toBe(false)
  })

  it('packs the old rows without the composer in the band, which took no room in them', () => {
    const doc = defaultDesign()
    const home = {
      headline: null,
      composer: 'band',
      blocks: [
        { type: 'composer', width: 'two_thirds' },
        { type: 'contact', width: 'third' },
        { type: 'ideas', width: 'full', sort: 'top', count: 5 },
      ],
    }
    const parsed = portalDesign.parse({ ...doc, pages: { ...doc.pages, home } })
    const places = parsed.pages.home.blocks.map(({ type, grid }) => [type, grid])
    expect(places).toEqual([
      ['composer', { x: 0, y: 2, w: 12, h: 1 }],
      // Alone in its row once the composer is in the band, as the old rows drew it.
      ['contact', { x: 0, y: 0, w: 12, h: 1 }],
      ['ideas', { x: 0, y: 1, w: 12, h: 1 }],
    ])
  })
})

describe('blockPageOff', () => {
  const on = {
    feedback: true,
    roadmap: true,
    changelog: true,
    help: true,
    support: true,
    status: true,
  }
  it('names the page a block needs while it is off, and nothing while it is on', () => {
    expect(blockPageOff('status', { ...on, status: false })).toBe('status')
    expect(blockPageOff('help_topics', { ...on, help: false })).toBe('help')
    expect(blockPageOff('status', on)).toBeNull()
    expect(blockPageOff('welcome', { ...on, feedback: false })).toBeNull()
  })
})
