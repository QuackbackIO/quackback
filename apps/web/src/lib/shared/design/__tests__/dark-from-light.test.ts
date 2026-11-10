/**
 * Dark mode worked out from light where the design sets no dark brand colour:
 * the brand colour lightened in its own hue until it reads on the dark page,
 * a monochrome brand's colour the dark page's text colour, and a brand band
 * of a dark brand colour kept in that colour. A dark colour the design sets
 * is its own, and light mode never changes.
 */
import { describe, expect, it } from 'vitest'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { contrastRatio } from '../contrast'
import { resolveDesign } from '../resolve'
import { defaultDesign, type PortalDesign } from '../schema'

const NAVY = '#0c4198'
const design = (accent: string, change: (d: PortalDesign) => void = () => {}) => {
  const d = defaultDesign()
  d.brand.light.accent = accent
  change(d)
  return d
}
const oklch = (c: string) => parseOklch(c.startsWith('oklch') ? c : hexToOklch(c))!
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('dark mode’s brand colour, worked out from light', () => {
  it('lightens a navy in its own hue until it reads on the dark page, never grey or yellow', () => {
    const dark = resolveDesign(design(NAVY)).dark!
    expect(contrastRatio(String(dark.primary), String(dark.background))).toBeGreaterThanOrEqual(3)
    const was = oklch(NAVY)
    const now = oklch(String(dark.primary))
    expect(hueGap(now.h, was.h)).toBeLessThan(12)
    expect(now.c).toBeGreaterThan(0.08)
    expect(now.l).toBeGreaterThan(was.l)
  })

  it('keeps a brand colour that already reads on the dark page', () => {
    const dark = resolveDesign(design('#ff385c')).dark!
    expect(oklch(String(dark.primary)).h).toBeCloseTo(oklch('#ff385c').h, 0)
    expect(oklch(String(dark.primary)).l).toBeCloseTo(oklch('#ff385c').l, 2)
  })

  it('takes the dark page’s text colour for a black brand colour', () => {
    const dark = resolveDesign(design('#000000')).dark!
    expect(contrastRatio(String(dark.primary), String(dark.background))).toBeGreaterThanOrEqual(7)
    expect(oklch(String(dark.primary)).c).toBeLessThan(0.03)
  })

  it('keeps a dark brand colour the design sets', () => {
    const dark = resolveDesign(design(NAVY, (d) => (d.brand.dark = { accent: '#ff8800' }))).dark!
    expect(String(dark.primary)).toBe('#ff8800')
  })

  it('leaves light mode as it was', () => {
    const light = resolveDesign(design(NAVY)).light!
    expect(String(light.primary)).toBe(NAVY)
  })
})

describe('a brand band in dark mode', () => {
  const band = (accent: string, change: (d: PortalDesign) => void = () => {}) =>
    resolveDesign(
      design(accent, (d) => {
        d.layout.hero = 'brand'
        change(d)
      })
    ).tokens.dark['--qb-band-bg']

  it('keeps a dark brand colour, its white words reading on it', () => {
    expect(band(NAVY)).toBe(NAVY)
    expect(band('#000000')).toBe('#000000')
  })

  it('takes the dark brand colour the design sets, and a light brand colour as it is', () => {
    expect(band(NAVY, (d) => (d.brand.dark = { accent: '#4d7fd6' }))).toBe('#4d7fd6')
    const bright = resolveDesign(design('#ffe01b')).dark!.primary
    expect(band('#ffe01b')).toBe(bright)
  })
})
