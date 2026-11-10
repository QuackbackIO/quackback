import { describe, expect, it } from 'vitest'
import { colourPairs, colourRowIssues } from '../colour-pairs'
import { newBlock } from '../home'
import { defaultDesign } from '../schema'

describe('colourPairs', () => {
  it('checks every pair in each mode the design shows, and today’s portal passes', () => {
    const pairs = colourPairs(defaultDesign())
    expect(new Set(pairs.map((p) => p.mode))).toEqual(new Set(['light', 'dark']))
    expect(pairs.filter((p) => p.mode === 'light').map((p) => `${p.text} on ${p.on}`)).toEqual([
      'Text on the page',
      'Text on cards',
      'Text on raised surfaces',
      'Secondary text on the page',
      'Secondary text on cards',
      'Button text on buttons',
      'Links on the page',
      'Links on cards',
      'Field edges on the page',
      'The focus ring on the page',
      'The focus ring on cards',
      'Vote box edges on cards',
      'Secondary text on the footer',
    ])
    expect(pairs.every((p) => p.passes)).toBe(true)
  })

  it('puts a failing pair first, with its contrast and the contrast it needs', () => {
    const design = defaultDesign()
    design.mode = 'light'
    design.brand.light.raised = '#333333'
    const [first] = colourPairs(design)
    expect(first).toMatchObject({
      mode: 'light',
      text: 'Text',
      on: 'raised surfaces',
      passes: false,
      target: 4.5,
    })
    expect(first!.ratio).toBeLessThan(4.5)
  })

  it('checks the headline on a coloured band', () => {
    const design = defaultDesign()
    design.mode = 'light'
    design.layout.band = 'brand'
    expect(colourPairs(design).some((p) => p.on === 'the hero')).toBe(true)
  })

  it('checks the focus ring on the band and on a header in the band’s colour', () => {
    const design = defaultDesign()
    design.mode = 'light'
    design.brand.light.accent = '#14532d'
    design.layout.band = 'brand'
    design.layout.headerOnBand = true
    const ring = colourPairs(design).filter((p) => p.text === 'The focus ring')
    expect(ring.map((p) => p.on)).toEqual(
      expect.arrayContaining(['the page', 'cards', 'the hero', 'the header'])
    )
    expect(ring.every((p) => p.passes)).toBe(true)
  })

  it('checks what blocks in a tone draw, only for the tones in use', () => {
    const doc = defaultDesign()
    const tinted = {
      ...newBlock('welcome'),
      look: { tone: 'tint' as const, align: 'start' as const },
    }
    const brand = {
      ...newBlock('links'),
      look: { tone: 'brand' as const, align: 'start' as const },
    }
    doc.pages.home.blocks = [tinted]
    const on = (d: typeof doc) =>
      colourPairs(d)
        .filter((p) => p.mode === 'light')
        .map((p) => p.on)
    expect(on(doc)).toContain('tinted blocks')
    expect(on(doc)).not.toContain('brand colour blocks')
    doc.pages.home.blocks = [brand]
    expect(on(doc)).toEqual(
      expect.arrayContaining(['brand colour blocks', 'vote boxes in brand colour blocks'])
    )
    // The block is drawn in the button's colours, and the vote boxes a step towards its text.
    const pairs = colourPairs(doc).filter((p) => p.mode === 'light')
    const block = pairs.find((p) => p.on === 'brand colour blocks')!
    const button = pairs.find((p) => p.text === 'Button text')!
    expect([block.foreground, block.background]).toEqual([button.foreground, button.background])
    const vote = pairs.find((p) => p.on === 'vote boxes in brand colour blocks')!
    expect(vote.background).not.toBe(block.background)
  })

  it('lists exact text colours, saying when one was moved so it reads', () => {
    const doc = defaultDesign()
    doc.mode = 'light'
    doc.tune = { heading: { colour: '#e0e0e0' } }
    const heading = colourPairs(doc).find((p) => p.text === 'Section headings colour')!
    expect(heading).toMatchObject({ movedFrom: '#e0e0e0', passes: true })
  })
})

describe('colourRowIssues', () => {
  it('finds a text colour that is hard to read, and a colour that reads in its place', () => {
    const design = defaultDesign()
    design.brand.light.ink = '#bbbbbb'
    const { ink } = colourRowIssues(design)
    expect(ink?.on).toContain('the page')
    expect(ink?.fix).toBeTruthy()
    design.brand.light.ink = ink!.fix!
    expect(colourRowIssues(design).ink).toBeUndefined()
  })

  it('finds nothing when every pair reads', () => {
    expect(colourRowIssues(defaultDesign())).toEqual({})
  })
})
