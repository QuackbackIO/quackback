/**
 * Presets are design documents in their own right: each applies a look
 * (mode, colours, fonts, shape and layout) to a draft, leaves its pages, menu
 * and words alone, and passes every pair the portal paints in both modes.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { applyPreset, DESIGN_PRESETS } from '../presets'
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
  it('replaces the look and keeps the pages, menu and words', () => {
    const doc = defaultDesign()
    doc.pages.feedback.headline = { title: { en: 'Ideas' }, subtitle: {} }
    doc.vocabulary.post = 'suggestion'
    const preset = DESIGN_PRESETS.find((p) => p.id === 'editorial')!
    const applied = applyPreset(doc, preset)
    expect(applied.layout).toEqual(preset.look.layout)
    expect(applied.brand.fonts).toEqual(preset.look.brand.fonts)
    expect(applied.pages.feedback.headline).toEqual(doc.pages.feedback.headline)
    expect(applied.vocabulary.post).toBe('suggestion')
    expect(applied.brand.logo).toEqual(doc.brand.logo)
  })
})
