/**
 * The header strip sent with a screenshot: the top of the page at the
 * capture's own resolution, lossless, tall enough to hold the headline and
 * its subtitle for the font stage, and shortened until its PNG fits the
 * request's bound (a photo-heavy page encodes large).
 */
import { describe, expect, it } from 'vitest'
import {
  boundedJpeg,
  HERO_MAX_CHARS,
  heroRows,
  STRIP_MAX_CHARS,
  stripHeight,
  tallestStrip,
} from '../brand-shots'

describe('tallestStrip', () => {
  it('keeps the first height whose encoding fits, tallest first', () => {
    const tried: number[] = []
    const strip = tallestStrip(1800, 2, (h) => {
      tried.push(h)
      return 'x'.repeat(h >= 1800 ? STRIP_MAX_CHARS + 1 : 100)
    })
    expect(tried[0]).toBe(1800)
    expect(strip).toEqual({ url: 'x'.repeat(100), height: tried[1] })
    expect(tried[1]).toBeLessThan(1800)
  })

  it('never asks for more rows than the capture has', () => {
    const tried: number[] = []
    tallestStrip(500, 1, (h) => (tried.push(h), 'ok'))
    expect(tried).toEqual([500])
  })

  it('gives nothing when even the header alone does not fit or cannot be encoded', () => {
    expect(tallestStrip(1800, 2, () => 'x'.repeat(STRIP_MAX_CHARS + 1))).toBeNull()
    expect(tallestStrip(1800, 2, () => null)).toBeNull()
  })
})

describe('stripHeight', () => {
  it('covers the first screen, about 900 CSS px, at the capture’s scale', () => {
    expect(stripHeight(2)).toBe(1800)
    expect(stripHeight(1)).toBe(900)
  })
})

describe('the first screen for a hero photo', () => {
  it('spans about 1100 CSS px at the capture’s scale, never more rows than it has', () => {
    expect(heroRows(4000, 2)).toBe(2200)
    expect(heroRows(900, 2)).toBe(900)
  })

  it('takes the first quality whose JPEG fits the bound, best first', () => {
    const tried: number[] = []
    const url = boundedJpeg(1800, (q) => {
      tried.push(q)
      return 'x'.repeat(q > 0.85 ? HERO_MAX_CHARS + 1 : 100)
    })
    expect(url).toBe('x'.repeat(100))
    expect(tried[0]).toBeGreaterThan(tried[1]!)
    expect(boundedJpeg(1800, () => 'x'.repeat(HERO_MAX_CHARS + 1))).toBeNull()
    expect(boundedJpeg(0, () => 'ok')).toBeNull()
  })
})
