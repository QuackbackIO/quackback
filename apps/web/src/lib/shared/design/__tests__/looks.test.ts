/**
 * Looks and Home layouts: a look carries colours, fonts, shape, layout and
 * exact values and nothing else. Taking one keeps the workspace's colours,
 * fonts and mode unless asked to take its colours too. A Home layout arranges the blocks while
 * keeping each one already written, and leaves out blocks whose page is off.
 */
import { describe, expect, it } from 'vitest'
import { lookOf, withLook } from '../looks'
import { lookTile } from '../look-tile'
import { colourPairs } from '../colour-pairs'
import { contrastRatio } from '../contrast'
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
    const next = withLook(target, look, { itsColours: true })
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

/** A workspace whose brand was matched: its own colours, dark palette, fonts and logo. */
function matched(accent = '#1a7f37') {
  const doc = defaultDesign()
  doc.mode = 'light'
  doc.brand.light = { accent, background: '#ffffff', ink: '#1f2328' }
  doc.brand.dark = { background: '#0d1117', ink: '#e6edf3' }
  doc.brand.fonts.heading = { kind: 'bundled', id: 'archivo' }
  doc.brand.fonts.headingWeight = 800
  doc.brand.logo.name = 'Acme'
  doc.tune = { headline: { colour: '#1f2328' } }
  return doc
}

describe('taking a look', () => {
  it('keeps the brand’s colours, fonts, mode and logo, and takes only the treatment', () => {
    for (const preset of DESIGN_PRESETS) {
      const next = withLook(matched(), preset.look)
      expect(next.brand.light, preset.id).toEqual(matched().brand.light)
      expect(next.brand.dark, preset.id).toEqual(matched().brand.dark)
      const { heading, body, headingWeight } = next.brand.fonts
      expect({ heading, body, headingWeight }, preset.id).toEqual({
        heading: matched().brand.fonts.heading,
        body: matched().brand.fonts.body,
        headingWeight: 800,
      })
      // Type scale and case are treatment, so they come with the look.
      expect(next.brand.fonts.scale, preset.id).toBe(preset.look.brand.fonts.scale)
      expect(next.mode, preset.id).toBe('light')
      expect(next.brand.logo, preset.id).toEqual(matched().brand.logo)
      expect(next.tune?.headline?.colour, preset.id).toBe('#1f2328')
      expect(next.shape, preset.id).toEqual(preset.look.shape)
      expect(next.layout, preset.id).toEqual(preset.look.layout)
      expect(portalDesign.safeParse(next).success, preset.id).toBe(true)
    }
  })

  it('takes its colours, fonts and mode too when asked, still keeping the logo', () => {
    for (const preset of DESIGN_PRESETS) {
      const next = withLook(matched(), preset.look, { itsColours: true })
      expect(next.brand.light, preset.id).toEqual(preset.look.brand.light)
      expect(next.brand.dark, preset.id).toEqual(preset.look.brand.dark)
      expect(next.brand.fonts, preset.id).toEqual(preset.look.brand.fonts)
      expect(next.mode, preset.id).toBe(preset.look.mode)
      expect(next.brand.logo, preset.id).toEqual(matched().brand.logo)
    }
  })

  it('keeps the hero’s words readable in every look, with the brand’s colours or its own', () => {
    for (const accent of ['#1a7f37', '#9fe870', '#7c3aed'])
      for (const preset of DESIGN_PRESETS)
        for (const itsColours of [false, true]) {
          const next = withLook(matched(accent), preset.look, { itsColours })
          const hero = colourPairs(next).filter(
            (each) => each.on === 'the hero' && each.text !== 'The focus ring'
          )
          for (const each of hero)
            expect(each.passes, `${accent} ${preset.id} ${itsColours} ${each.text}`).toBe(true)
        }
  })
})

describe('lookTile', () => {
  it('draws the brand’s own accent, fonts and logo with the look’s treatment', () => {
    const studio = DESIGN_PRESETS.find((each) => each.id === 'studio')!
    const tile = lookTile(withLook(matched(), studio.look))
    expect(tile.band.toLowerCase()).toBe('#1a7f37')
    expect(tile.heading).toContain('Archivo')
    expect(tile.weight).toBe(800)
    expect(tile.corners).toBe(studio.look.shape.corners)
  })

  it('draws the hero letters readable on every tile, light accents included', () => {
    for (const accent of ['#1a7f37', '#9fe870', '#ffd400'])
      for (const preset of DESIGN_PRESETS) {
        const tile = lookTile(withLook(matched(accent), preset.look))
        expect(
          contrastRatio(tile.bandInk, tile.behind),
          `${accent} ${preset.id}`
        ).toBeGreaterThanOrEqual(3)
      }
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

describe('a look’s element looks', () => {
  const styled = () => {
    const doc = defaultDesign()
    doc.style = {
      button: { base: { radius: 2, background: '#ff0000', font: 'display' } },
      postCard: { hover: { shadow: 'soft' } },
    }
    doc.styleDark = { button: { base: { background: '#330000' } } }
    doc.stylePhone = { button: { base: { radius: 0 } } }
    return doc
  }

  it('carries style, dark and phone, and takes them whole with its colours', () => {
    const look = lookOf(styled())
    expect(look.style).toEqual(styled().style)
    const next = withLook(defaultDesign(), look, { itsColours: true })
    expect(next.style).toEqual(styled().style)
    expect(next.styleDark).toEqual(styled().styleDark)
    expect(next.stylePhone).toEqual(styled().stylePhone)
  })

  it('replaces the draft’s treatment but keeps its own colours and fonts', () => {
    const own = defaultDesign()
    own.style = {
      button: { base: { radius: 30, background: '#00ff00' } },
      input: { base: { radius: 9 } },
    }
    own.styleDark = { button: { base: { background: '#003300' } } }
    own.stylePhone = { input: { base: { radius: 1 } } }
    const next = withLook(own, lookOf(styled()))
    expect(next.style).toEqual({
      button: { base: { radius: 2, background: '#00ff00' } },
      postCard: { hover: { shadow: 'soft' } },
    })
    expect(next.styleDark).toEqual(own.styleDark)
    expect(next.stylePhone).toEqual({ button: { base: { radius: 0 } } })
    expect(portalDesign.safeParse(next).success).toBe(true)
  })

  it('clears element looks when the look has none, as a look saved before them does', () => {
    const own = defaultDesign()
    own.style = { input: { base: { radius: 9, color: '#123456' } } }
    own.stylePhone = { input: { base: { radius: 1 } } }
    const old = lookOf(defaultDesign())
    expect(old).not.toHaveProperty('style')
    const next = withLook(own, old)
    expect(next.style).toEqual({ input: { base: { color: '#123456' } } })
    expect(next).not.toHaveProperty('stylePhone')
  })
})
