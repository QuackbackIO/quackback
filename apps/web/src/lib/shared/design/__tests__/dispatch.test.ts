/**
 * The operations people and Quackback AI change Home's blocks and the pages'
 * parts with: one vocabulary, each checked by the block registry, and Home
 * settled after any operation that changes which blocks it holds or their order.
 */
import { describe, expect, it } from 'vitest'
import { removeBlock, setBlockSetting, setPageSection, type OpWorld } from '../design-ops'
import { applyDesignOp, refusalOf, SETTLES, type DesignOp } from '../dispatch'
import { insertHomeBlock, settleHome } from '../home'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const world: OpWorld = { gates: GATES, places: { boards: [], roadmaps: [], categories: [] } }

function design(): PortalDesign {
  const d = defaultDesign()
  d.nav.home = { on: true, tab: true }
  d.pages.home.blocks = [
    { id: 'composer01', type: 'composer', grid: { x: 0, y: 0, w: 8, h: 1 } },
    { id: 'status0001', type: 'status', grid: { x: 8, y: 0, w: 4, h: 1 } },
    {
      id: 'ideas00001',
      type: 'ideas',
      sort: 'trending',
      count: 3,
      grid: { x: 0, y: 1, w: 6, h: 1 },
    },
    { id: 'updates001', type: 'updates', count: 3, grid: { x: 6, y: 1, w: 6, h: 1 } },
    { id: 'search0001', type: 'help_search', grid: { x: 0, y: 2, w: 12, h: 1 } },
  ] as PortalDesign['pages']['home']['blocks']
  return portalDesign.parse(d)
}

const made = (op: DesignOp, start = design()) => {
  const draft = structuredClone(start)
  return { result: applyDesignOp(draft, op), draft }
}
const blockOf = (d: PortalDesign, id: string) => d.pages.home.blocks.find((b) => b.id === id)!

describe('a block’s settings', () => {
  it('sets one through the registry, by id or by place', () => {
    for (const block of ['ideas00001', 2]) {
      const { result, draft } = made({ op: 'block.set', block, key: 'count', value: 10 })
      expect(result).toEqual({ ok: true })
      expect(blockOf(draft, 'ideas00001')).toMatchObject({ count: 10 })
    }
  })

  it('refuses a value the block does not offer, before and during, leaving the draft alone', () => {
    const op: DesignOp = { op: 'block.set', block: 'ideas00001', key: 'count', value: 7 }
    const { result, draft } = made(op)
    expect(result).toEqual({ ok: false, refusal: 'How many can be 3, 5 or 10' })
    expect(refusalOf(design(), op)).toBe('How many can be 3, 5 or 10')
    expect(draft).toEqual(design())
  })

  it('makes several settings as one change, or none of them', () => {
    const settings = { sort: 'new', count: 5 }
    const { draft } = made({ op: 'block.setEach', block: 'ideas00001', settings })
    expect(blockOf(draft, 'ideas00001')).toMatchObject(settings)
    const refused = made({
      op: 'block.setEach',
      block: 'ideas00001',
      settings: { sort: 'new', count: 7 },
    })
    expect(refused.result.ok).toBe(false)
    expect(refused.draft).toEqual(design())
  })

  it('says so when the block is gone', () => {
    expect(
      refusalOf(design(), { op: 'block.set', block: 'nothere01', key: 'count', value: 5 })
    ).toBe('That block is no longer on Home')
  })

  it('is the same change the AI makes, once it has read the words', () => {
    const ai = setBlockSetting(design(), world, 'Top posts', 'count', '5')
    const { draft } = made({ op: 'block.set', block: 'ideas00001', key: 'count', value: 5 })
    expect(ai.ok && ai.design).toEqual(portalDesign.parse(draft))
  })
})

describe('which blocks Home holds', () => {
  it('floats up what was under a removed block, and names the block now in its place', () => {
    const { result, draft } = made({ op: 'block.remove', block: 'composer01' })
    expect(result).toMatchObject({ ok: true, near: { id: 'status0001' } })
    expect(blockOf(draft, 'ideas00001').grid.y).toBe(0)
    const ai = removeBlock(design(), world, 'composer01')
    expect(ai.ok && ai.design.pages.home.blocks).toEqual(draft.pages.home.blocks)
  })

  it('names the block before when the last is removed, and none when Home empties', () => {
    expect(made({ op: 'block.remove', block: 'search0001' }).result).toMatchObject({
      near: { id: 'updates001' },
    })
    const one = design()
    one.pages.home.blocks = one.pages.home.blocks.slice(0, 1)
    expect(made({ op: 'block.remove', block: 0 }, one).result).toEqual({ ok: true, near: null })
  })

  it('leaves Home settled after every operation that changes its blocks or their order', () => {
    // Overlapping and floating places, as an older document may hold them.
    const loose = design()
    loose.pages.home.blocks[1]!.grid = { x: 6, y: 0, w: 6, h: 1 }
    loose.pages.home.blocks[4]!.grid = { x: 0, y: 9, w: 12, h: 1 }
    const ops: DesignOp[] = [
      { op: 'block.add', type: 'contact', after: 'status0001' },
      { op: 'block.duplicate', id: 'ideas00001' },
      { op: 'block.remove', block: 'updates001' },
      { op: 'block.step', id: 'search0001', by: -1 },
      { op: 'block.place', id: 'composer01', place: 3 },
    ]
    expect(new Set(ops.map((op) => op.op))).toEqual(SETTLES)
    for (const op of ops) {
      const { draft } = made(op, loose)
      const again = structuredClone(draft)
      settleHome(again)
      expect(draft.pages.home.blocks, op.op).toEqual(again.pages.home.blocks)
    }
  })

  it('adds a block under another, as Add always has, and hands it back', () => {
    const { result, draft } = made({ op: 'block.add', type: 'contact', after: 'status0001' })
    expect(result.ok && result.block?.type).toBe('contact')
    const before = design()
    const added = insertHomeBlock(before, 'contact', 'status0001')
    const placed = (d: PortalDesign) => d.pages.home.blocks.map((b) => [b.type, b.grid])
    expect(placed(draft)).toEqual(placed(before))
    expect(added.grid.x).toBe(8)
  })

  it('turns Home on with the block when asked, as Turn on Home does, and only then', () => {
    const off = design()
    off.nav.home.on = false
    const count = off.pages.home.blocks.length
    const plain = made({ op: 'block.add', type: 'contact' }, off).draft
    expect(plain.nav.home.on).toBe(false)
    const shown = made({ op: 'block.add', type: 'contact', turnOnHome: { gates: GATES } }, off)
    expect(shown.draft.nav.home.on).toBe(true)
    expect(shown.draft.pages.home.blocks).toHaveLength(count + 1)
    // An empty Home gets the block alone, never the starters.
    off.pages.home.blocks = []
    const empty = made({ op: 'block.add', type: 'contact', turnOnHome: { gates: GATES } }, off)
    expect(empty.draft.pages.home.blocks.map((b) => b.type)).toEqual(['contact'])
  })
})

describe('the grid', () => {
  it('starts a drag’s step from where the drag began, and goes back there with no change', () => {
    const start = design()
    const moved = made({
      op: 'block.grid',
      id: 'search0001',
      change: { move: { x: 0, y: 0 } },
      gates: GATES,
    })
    expect(moved.result).toEqual({ ok: true, place: { x: 0, y: 0, w: 12, h: 1 } })
    const back = made(
      {
        op: 'block.grid',
        id: 'search0001',
        change: null,
        gates: GATES,
        from: start.pages.home.blocks,
      },
      moved.draft
    )
    expect(back.draft.pages.home.blocks).toEqual(start.pages.home.blocks)
  })
})

describe('the pages’ parts', () => {
  it('sets a section’s setting as the AI does, leaving out today’s look', () => {
    const { draft } = made({
      op: 'section.set',
      type: 'help.search',
      key: 'search',
      value: 'large',
    })
    expect(draft.pages.help).toEqual({ search: 'large' })
    const ai = setPageSection(design(), world, 'help', 'search', 'large')
    expect(ai.ok && ai.design.pages.help).toEqual(draft.pages.help)
    const back = made(
      { op: 'section.set', type: 'help.search', key: 'search', value: 'standard' },
      draft
    )
    expect(back.draft.pages.help).toBeUndefined()
  })

  it('refuses a section setting it does not offer', () => {
    expect(
      refusalOf(design(), { op: 'section.set', type: 'help.search', key: 'search', value: 'huge' })
    ).toBe('Size can be Standard or Large')
  })

  it('writes a page choice, and leaves it out at today’s look', () => {
    const set = made({ op: 'page.choice', page: 'changelog', key: 'subscribe', value: 'under' })
    expect(set.draft.pages.changelog).toEqual({ subscribe: 'under' })
    const back = made(
      { op: 'page.choice', page: 'changelog', key: 'subscribe', value: 'beside' },
      set.draft
    )
    expect(back.draft.pages.changelog).toBeUndefined()
  })

  it('writes words typed on the page, and gives them back to the portal’s own when emptied', () => {
    const field = { kind: 'feed', part: 'prompt' } as const
    const typed = made({
      op: 'words.set',
      field,
      locale: 'en',
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
      },
    })
    expect(typed.draft.pages.feedback.copy.prompt).toEqual({ en: 'Hi' })
    const cleared = made(
      { op: 'words.set', field, locale: 'en', doc: { type: 'doc', content: [] } },
      typed.draft
    )
    expect(cleared.draft.pages.feedback.copy.prompt).toBeUndefined()
  })
})
