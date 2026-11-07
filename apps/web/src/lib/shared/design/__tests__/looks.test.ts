/**
 * Looks and Home layouts: a look carries colours, fonts, shape, layout and
 * exact values and nothing else; a Home layout arranges the blocks while
 * keeping each one already written, and leaves out blocks whose page is off.
 */
import { describe, expect, it } from 'vitest'
import { lookOf, withLook } from '../looks'
import { arrangeHome, HOME_LAYOUTS, layoutFits } from '../home-layouts'
import { DESIGN_PRESETS, applyPreset } from '../presets'
import { newBlock } from '../home'
import { defaultDesign, portalDesign } from '../schema'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

describe('lookOf and withLook', () => {
  it('carries the look and its exact values, keeping pages, words and logo', () => {
    const source = defaultDesign()
    source.brand.light.accent = '#ff0000'
    source.shape.corners = 'pill'
    source.tune = { button: { height: 44 } }
    source.layout.postCardHides = ['tags']
    const look = lookOf(source)
    expect(look.layout.postCardHides).toBeUndefined()

    const target = defaultDesign()
    target.brand.logo.name = 'Acme'
    target.pages.home.blocks = [newBlock('links')]
    target.layout.postCardHides = ['meta']
    const next = withLook(target, look)
    expect(next.brand.light.accent).toBe('#ff0000')
    expect(next.shape.corners).toBe('pill')
    expect(next.tune).toEqual({ button: { height: 44 } })
    expect(next.brand.logo.name).toBe('Acme')
    expect(next.pages.home.blocks).toHaveLength(1)
    expect(next.layout.postCardHides).toEqual(['meta'])
    expect(portalDesign.safeParse(next).success).toBe(true)
  })

  it('takes exact values away when the look has none, as presets do', () => {
    const target = defaultDesign()
    target.tune = { button: { height: 44 } }
    expect(withLook(target, lookOf(defaultDesign())).tune).toBeUndefined()
    expect(applyPreset(target, DESIGN_PRESETS[1]!).tune).toBeUndefined()
  })
})

describe('arrangeHome', () => {
  it('keeps a written block, with its heading, at the layout’s place and size', () => {
    const links = newBlock('links')
    const ideas = { ...newBlock('ideas', { w: 4 }), heading: { en: 'Top asks' } }
    const layout = HOME_LAYOUTS.find((each) => each.id === 'feedback')!
    const blocks = arrangeHome([links, ideas], layout, ALL_ON)
    const kept = blocks.find((block) => block.id === ideas.id)
    expect(kept?.heading).toEqual({ en: 'Top asks' })
    // Under the full-width composer, eight columns wide beside status.
    expect(kept?.grid).toEqual({ x: 0, y: 1, w: 8, h: 1 })
    expect(blocks.map((block) => block.type).slice(0, 2)).toEqual(['composer', 'ideas'])
    // A block the layout does not name follows, so nothing written is lost.
    expect(blocks.at(-1)?.id).toBe(links.id)
  })

  it('leaves out blocks whose page is off, and every layout is valid', () => {
    const noHelp = { ...ALL_ON, help: false, support: false }
    for (const layout of HOME_LAYOUTS) {
      const blocks = arrangeHome([], layout, noHelp)
      expect(
        blocks.some((block) => block.type.startsWith('help') || block.type === 'contact')
      ).toBe(false)
      const design = defaultDesign()
      design.pages.home.blocks = arrangeHome([], layout, ALL_ON)
      expect(portalDesign.safeParse(design).success).toBe(true)
    }
  })

  it('offers a layout only where the workspace has what it leads with', () => {
    const help = HOME_LAYOUTS.find((each) => each.id === 'help')!
    expect(layoutFits(help, ALL_ON)).toBe(true)
    expect(layoutFits(help, { ...ALL_ON, help: false })).toBe(false)
  })
})
