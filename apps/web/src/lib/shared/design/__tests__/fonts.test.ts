/**
 * The design engine's one font registry: every bundled id has a label, a
 * stack and the weights its stylesheet loads, and a stack resolves back to
 * its id so the portal loads the family a design uses.
 */
import { describe, expect, it } from 'vitest'
import { BRANDING_FONTS } from '@/lib/shared/theme/fonts'
import { BUNDLED_FONTS, bundledFontIdForStack, bundledFontStack, designFontIds } from '../fonts'
import { BUNDLED_FONT_IDS } from '../options'
import { defaultDesign } from '../schema'

describe('BUNDLED_FONTS', () => {
  it('covers every bundled id', () => {
    expect(Object.keys(BUNDLED_FONTS).sort()).toEqual([...BUNDLED_FONT_IDS].sort())
  })

  it('keeps today’s stacks for today’s families', () => {
    for (const font of BRANDING_FONTS) expect(bundledFontStack(font.id), font.id).toBe(font.value)
  })

  it('loads the regular weight and a heading weight for every family', () => {
    for (const [id, font] of Object.entries(BUNDLED_FONTS)) {
      expect(font.weights, id).toContain(400)
      expect(Math.max(...font.weights), id).toBeGreaterThanOrEqual(600)
    }
  })

  it('resolves a stack back to its id', () => {
    expect(bundledFontIdForStack(bundledFontStack('fraunces'))).toBe('fraunces')
    expect(bundledFontIdForStack('"Comic Sans MS", cursive')).toBeNull()
  })
})

describe('designFontIds', () => {
  it('lists the body and heading families once each', () => {
    const doc = defaultDesign()
    expect(designFontIds(doc)).toEqual(['inter'])
    doc.brand.fonts.heading = { kind: 'bundled', id: 'fraunces' }
    expect(designFontIds(doc)).toEqual(['inter', 'fraunces'])
  })

  it('loads an uploaded family’s bundled fallback', () => {
    const doc = defaultDesign()
    doc.brand.fonts.body = { kind: 'uploaded', family: 'Acme Sans', files: [], fallback: 'manrope' }
    expect(designFontIds(doc)).toEqual(['manrope', 'inter'])
  })
})
