/**
 * Extra brand colours: up to two more, which the band and a Home block's look
 * can be drawn in, as they can in the brand colour or the second, with text
 * that reads on each.
 */
import { describe, expect, it } from 'vitest'
import { colourPairs } from '../colour-pairs'
import { bandContrast, modeTokens } from '../components'
import { contrastRatio } from '../contrast'
import { resolveDesign } from '../resolve'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { brandSwatches, designRoles, wordsRoles } from '../colour-roles'

const FOREST = '#163300'
const CYAN = '#a0e1e1'

function withExtras(): PortalDesign {
  const doc = defaultDesign()
  doc.mode = 'light'
  doc.brand.light.accent = '#9fe870'
  doc.brand.light.extra = [FOREST, CYAN]
  return doc
}

const lightTokens = (doc: PortalDesign) => {
  const light = resolveDesign(doc).light!
  return { light, tokens: modeTokens(doc, light, 'light') }
}

describe('extra brand colours', () => {
  it('holds up to two', () => {
    const doc = withExtras()
    expect(portalDesign.safeParse(doc).success).toBe(true)
    doc.brand.light.extra = [FOREST, CYAN, '#ffffff']
    expect(portalDesign.safeParse(doc).success).toBe(false)
  })

  it('are roles the design has a colour for, after the brand colour and the second', () => {
    const doc = withExtras()
    expect(designRoles(doc)).toEqual(['accent', 'extra1', 'extra2'])
    doc.brand.light.support = '#ffc091'
    doc.brand.light.extra = [FOREST]
    expect(designRoles(doc)).toEqual(['accent', 'support', 'extra1'])
  })

  it('are offered to words by name and colour, the brand colour first', () => {
    const doc = withExtras()
    expect(wordsRoles(doc)).toEqual([
      { role: 'accent', name: 'Brand colour', colour: doc.brand.light.accent },
      { role: 'extra1', name: 'Extra colour 1', colour: FOREST },
      { role: 'extra2', name: 'Extra colour 2', colour: CYAN },
    ])
  })

  it('fill the band in the colour it picks, with text that reads on it', () => {
    const doc = withExtras()
    doc.layout.band = 'brand'
    doc.layout.bandColour = 'extra1'
    const { light, tokens } = lightTokens(doc)
    expect(tokens['--qb-band-bg']).toBe(FOREST)
    expect(contrastRatio(tokens['--qb-band-ink']!, FOREST)).toBeGreaterThanOrEqual(4.5)
    expect(bandContrast(doc, light, 'light')?.background).toBe(FOREST)
  })

  it('tint the band from the colour it picks', () => {
    const doc = withExtras()
    doc.layout.band = 'tint'
    const accentTint = lightTokens(doc).tokens['--qb-band-bg']
    doc.layout.bandColour = 'extra2'
    const cyanTint = lightTokens(doc).tokens['--qb-band-bg']
    expect(cyanTint).not.toBe(accentTint)
    // A colour the design does not have falls back to the brand colour.
    doc.brand.light.extra = [FOREST]
    expect(lightTokens(doc).tokens['--qb-band-bg']).toBe(accentTint)
  })

  it('give blocks each extra colour and the text that reads on it', () => {
    const { tokens } = lightTokens(withExtras())
    expect(tokens['--qb-role-extra1']).toBe(FOREST)
    expect(contrastRatio(tokens['--qb-on-role-extra1']!, FOREST)).toBeGreaterThanOrEqual(4.5)
    expect(tokens['--qb-role-extra2']).toBe(CYAN)
    expect(tokens['--qb-role-support']).toBeUndefined()
  })

  it('check the text on blocks in each colour they use', () => {
    const doc = withExtras()
    doc.pages.home.blocks = [
      {
        type: 'contact',
        grid: { x: 0, y: 0, w: 4, h: 4 },
        look: { tone: 'brand', colour: 'extra1' },
      },
      {
        type: 'status',
        grid: { x: 4, y: 0, w: 4, h: 4 },
        look: { tone: 'tint', colour: 'extra2' },
      },
    ]
    const ons = colourPairs(doc).map((pair) => pair.on)
    expect(ons).toContain('blocks in the first extra colour')
    expect(ons).toContain('blocks tinted with the second extra colour')
    expect(ons).not.toContain('brand colour blocks')
  })
})

/** A mid blue both black and white reach 4.5:1 on, which white reads far clearer on. */
const MID_BLUE = '#0c73e5'
/** A red only black reaches 4.5:1 on. */
const RED = '#db483c'
const isLight = (c: string) => contrastRatio(c, '#000000') > contrastRatio(c, '#ffffff')

describe('text on a colour both black and white pass on', () => {
  it('is the light text, which reads clearer, on blocks, the band and the second colour’s button', () => {
    const doc = withExtras()
    doc.brand.light.extra = [MID_BLUE]
    doc.brand.light.support = MID_BLUE
    doc.shape.action = 'support'
    doc.layout.band = 'brand'
    doc.layout.bandColour = 'extra1'
    const { tokens } = lightTokens(doc)
    for (const token of ['--qb-on-role-extra1', '--qb-band-ink', '--qb-action-ink'] as const) {
      expect(isLight(tokens[token]!), token).toBe(true)
      expect(contrastRatio(tokens[token]!, MID_BLUE), token).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('stays dark where light text falls under 4.5:1', () => {
    const doc = withExtras()
    doc.brand.light.extra = [RED]
    const { tokens } = lightTokens(doc)
    expect(isLight(tokens['--qb-on-role-extra1']!)).toBe(false)
  })
})

describe('the brand’s swatches', () => {
  it('name each colour by its role, the logo’s last, each once', () => {
    const doc = withExtras()
    doc.brand.light.support = '#ffc091'
    doc.brand.logoColours = ['#163300', '#00b9ff']
    expect(brandSwatches(doc)).toEqual([
      { name: 'Brand colour', colour: '#9fe870' },
      { name: 'Second colour', colour: '#ffc091' },
      { name: 'Extra colour 1', colour: FOREST },
      { name: 'Extra colour 2', colour: CYAN },
      { name: 'Text', colour: '#0a0a0a' },
      { name: 'Background', colour: '#ffffff' },
      { name: 'Logo colour', colour: '#00b9ff' },
    ])
  })
})
