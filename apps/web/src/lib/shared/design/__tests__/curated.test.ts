/**
 * The builder's curated sets: about eight band looks and twelve font pairs.
 * Picking one writes every field the set covers; a design whose fields match
 * none reads as Custom, and reading it never changes it, so values from
 * Quackback AI or a website survive untouched.
 */
import { describe, expect, it } from 'vitest'
import {
  BAND_LOOKS,
  FONT_PAIRS,
  bandLookOf,
  fontPairOf,
  partsInUse,
  takeBandLook,
  takeFontPair,
} from '../curated'
import { DESIGN_PRESETS } from '../presets'
import { BUNDLED_FONT_IDS } from '../options'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { withLook } from '../looks'

const ALL_ON = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/** A design as Quackback AI or a website import leaves it: values no set makes. */
function imported(): PortalDesign {
  const design = defaultDesign()
  design.layout.hero = 'brand'
  design.layout.heroShape = 'split'
  design.layout.heroArt = 'petals'
  design.layout.heroHeight = 'tall'
  design.brand.fonts.heading = { kind: 'bundled', id: 'bodoni-moda' }
  design.brand.fonts.body = { kind: 'bundled', id: 'karla' }
  design.brand.fonts.display = { kind: 'bundled', id: 'unbounded' }
  return design
}

describe('the curated sets', () => {
  it('holds about eight band looks and twelve font pairs, each valid and distinct', () => {
    expect(BAND_LOOKS.length).toBeGreaterThanOrEqual(7)
    expect(BAND_LOOKS.length).toBeLessThanOrEqual(9)
    expect(FONT_PAIRS).toHaveLength(12)
    for (const pair of FONT_PAIRS) {
      expect(BUNDLED_FONT_IDS).toContain(pair.heading)
      expect(BUNDLED_FONT_IDS).toContain(pair.body)
    }
    // Each set reads back as itself, so no two make the same design.
    for (const look of BAND_LOOKS) {
      const design = defaultDesign()
      design.brand.light.support = '#0ea5e9'
      takeBandLook(design, look.id)
      expect(portalDesign.safeParse(design).success).toBe(true)
      expect(bandLookOf(design)).toBe(look.id)
    }
    for (const pair of FONT_PAIRS) {
      const design = defaultDesign()
      takeFontPair(design, pair.id)
      expect(portalDesign.safeParse(design).success).toBe(true)
      expect(fontPairOf(design)).toBe(pair.id)
    }
  })

  it('names every preset’s band and fonts, so a look from the picker is never Custom', () => {
    for (const preset of DESIGN_PRESETS) {
      const design = withLook(defaultDesign(), preset.look, { itsColours: true })
      expect(bandLookOf(design), preset.id).not.toBeNull()
      expect(fontPairOf(design), preset.id).not.toBeNull()
    }
  })

  it('writes every band field a look covers, clearing what the last one left', () => {
    const design = imported()
    takeBandLook(design, 'tint')
    expect(design.layout.hero).toBe('tint')
    expect(design.layout.heroShape).toBeUndefined()
    expect(design.layout.heroArt).toBeUndefined()
    // Height is the hero's own setting, beside its look.
    expect(design.layout.heroHeight).toBe('tall')
    expect(bandLookOf(design)).toBe('tint')
  })

  it('writes both fonts of a pair, drops a headline face and keeps a weight the face has', () => {
    const design = imported()
    design.brand.fonts.headingWeight = 800
    takeFontPair(design, 'bookish')
    expect(design.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'lora' })
    expect(design.brand.fonts.body).toEqual({ kind: 'bundled', id: 'inter' })
    expect(design.brand.fonts.display).toBeUndefined()
    // Lora is bundled up to 700: the nearest it has.
    expect(design.brand.fonts.headingWeight).toBe(700)
  })

  it('reads values no set makes as Custom, and reading changes nothing', () => {
    const design = imported()
    const before = structuredClone(design)
    expect(bandLookOf(design)).toBeNull()
    expect(fontPairOf(design)).toBeNull()
    expect(design).toEqual(before)
  })

  it('reads a field that only repeats its default as the set it matches', () => {
    const design = defaultDesign()
    design.layout.hero = 'brand'
    design.layout.heroShape = 'full'
    design.layout.heroHeight = 'roomy'
    design.layout.heroArt = 'none'
    expect(bandLookOf(design)).toBe('brand')
    // A fade's start and a blend's run only count where they draw.
    design.layout.fadeFrom = 'bottom'
    expect(bandLookOf(design)).toBe('brand')
  })

  it('reads two bundled faces no pair puts together as Custom', () => {
    const design = defaultDesign()
    design.brand.fonts.heading = { kind: 'bundled', id: 'bodoni-moda' }
    design.brand.fonts.body = { kind: 'bundled', id: 'karla' }
    expect(fontPairOf(design)).toBeNull()
  })

  it('reads an uploaded font as Custom', () => {
    const design = defaultDesign()
    design.brand.fonts.heading = {
      kind: 'uploaded',
      family: 'Brand Sans',
      files: [{ key: 'fonts/brand.woff2', weight: 600, style: 'normal' }],
      fallback: 'inter',
    }
    expect(fontPairOf(design)).toBeNull()
  })
})

describe('the parts used everywhere', () => {
  it('lists vote boxes only while Feedback is on, and status with Feedback or Roadmap', () => {
    expect(partsInUse(ALL_ON)).toContain('vote')
    const noFeedback = { ...ALL_ON, feedback: false }
    expect(partsInUse(noFeedback)).not.toContain('vote')
    expect(partsInUse(noFeedback)).toContain('status')
    const helpOnly = {
      feedback: false,
      roadmap: false,
      changelog: false,
      help: true,
      support: false,
      status: false,
    }
    expect(partsInUse(helpOnly)).not.toContain('vote')
    expect(partsInUse(helpOnly)).not.toContain('status')
    expect(partsInUse(helpOnly)).toContain('button')
    expect(partsInUse(helpOnly)).toContain('card')
  })
})
