/**
 * Presets are design documents in their own right: each applies a look
 * (mode, colours, fonts, shape and layout) to a draft, leaves its pages, menu
 * and words alone, and passes every pair the portal paints in both modes.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { applyPreset, DESIGN_PRESETS, keepOwn, takePreset } from '../presets'
import { resolveDesign } from '../resolve'
import { defaultDesign, portalDesign } from '../schema'
import { PAIRS } from './contrast-golden'

describe('DESIGN_PRESETS', () => {
  it('offers about eight looks that differ in more than colour', () => {
    expect(DESIGN_PRESETS.length).toBeGreaterThanOrEqual(8)
    const layouts = new Set(DESIGN_PRESETS.map((p) => JSON.stringify(p.look.layout)))
    const fonts = new Set(DESIGN_PRESETS.map((p) => JSON.stringify(p.look.brand.fonts)))
    expect(layouts.size).toBeGreaterThanOrEqual(6)
    expect(fonts.size).toBeGreaterThanOrEqual(6)
  })

  it.each(DESIGN_PRESETS.map((preset) => [preset.id, preset] as const))(
    '%s is a valid design that passes every pair in light and dark',
    (_id, preset) => {
      const doc = portalDesign.parse(applyPreset(defaultDesign(), preset))
      const resolved = resolveDesign({ ...doc, mode: 'auto' })
      expect(resolved.errors).toEqual([])
      for (const mode of ['light', 'dark'] as const) {
        const vars = resolved[mode]!
        for (const { pair, fg, bg, min } of PAIRS) {
          expect(
            contrastRatio(String(vars[fg]), String(vars[bg])),
            `${mode} ${pair}`
          ).toBeGreaterThanOrEqual(min)
        }
      }
    }
  )
})

describe('applyPreset', () => {
  it('replaces the look and keeps the pages and menu', () => {
    const doc = defaultDesign()
    doc.pages.feedback.headline = { title: { en: 'Ideas' }, subtitle: {} }
    const preset = DESIGN_PRESETS.find((p) => p.id === 'editorial')!
    const applied = applyPreset(doc, preset)
    expect(applied.layout).toEqual(preset.look.layout)
    expect(applied.brand.fonts).toEqual(preset.look.brand.fonts)
    expect(applied.pages.feedback.headline).toEqual(doc.pages.feedback.headline)
    expect(applied.brand.logo).toEqual(doc.brand.logo)
  })

  it('drops exact values, which would override the new look, and keeps what cards show', () => {
    const doc = defaultDesign()
    doc.tune = { headline: { size: 48 } }
    doc.layout.postCardHides = ['tags']
    const applied = applyPreset(doc, DESIGN_PRESETS[0]!)
    expect(applied.tune).toBeUndefined()
    expect(applied.layout.postCardHides).toEqual(['tags'])
  })
})

describe('takePreset', () => {
  it('changes a draft in place, removing exact values and a dark palette the look has none of', () => {
    const draft = defaultDesign()
    draft.tune = { card: { radius: 4 } }
    draft.brand.dark = structuredClone(draft.brand.light)
    const preset = DESIGN_PRESETS.find((each) => !each.look.brand.dark)!
    takePreset(draft, preset)
    expect(draft).toEqual(applyPreset(defaultDesign(), preset))
    expect(draft).not.toHaveProperty('tune')
  })
})

describe('keeping my colours and fonts', () => {
  const mine = () => {
    const doc = defaultDesign()
    doc.brand.light = {
      accent: '#163300',
      background: '#fafaf5',
      ink: '#0e0f0c',
      extra: ['#a0e1e1'],
    }
    doc.brand.dark = { background: '#101010' }
    doc.brand.fonts.heading = { kind: 'bundled', id: 'archivo' }
    doc.brand.fonts.headingWeight = 800
    doc.tune = { headline: { size: 64, colour: '#163300' }, button: { fill: '#9fe870', radius: 4 } }
    return doc
  }
  const preset = DESIGN_PRESETS.find((p) => p.id === 'bold')!

  it('keeps nothing unless asked', () => {
    expect(applyPreset(mine(), preset)).toEqual(applyPreset(mine(), preset, {}))
    expect(applyPreset(mine(), preset).brand.light).toEqual(preset.look.brand.light)
  })

  it('keeps the colours, in light and dark and as exact values, and takes the rest of the look', () => {
    const applied = applyPreset(mine(), preset, { colours: true })
    expect(applied.brand.light).toEqual(mine().brand.light)
    expect(applied.brand.dark).toEqual({ background: '#101010' })
    expect(applied.tune).toEqual({ headline: { colour: '#163300' }, button: { fill: '#9fe870' } })
    expect(applied.brand.fonts).toEqual(preset.look.brand.fonts)
    expect(applied.layout).toEqual(preset.look.layout)
  })

  it('keeps the fonts and their weight, and takes the preset’s colours', () => {
    const applied = applyPreset(mine(), preset, { fonts: true })
    expect(applied.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'archivo' })
    expect(applied.brand.fonts.headingWeight).toBe(800)
    expect(applied.brand.light).toEqual(preset.look.brand.light)
  })

  it('keeps them in a look taken whole', () => {
    const look = applyPreset(defaultDesign(), preset)
    const kept = keepOwn(look, mine(), { colours: true, fonts: true })
    expect(kept.brand.light).toEqual(mine().brand.light)
    expect(kept.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'archivo' })
    expect(kept.shape).toEqual(look.shape)
  })
})
