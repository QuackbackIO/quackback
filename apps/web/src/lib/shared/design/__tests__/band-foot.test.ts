/** How a band ends where the page begins: near colours and one hue fade, far ones keep an edge. */
import { describe, expect, it } from 'vitest'
import { fadesIntoPage, NEAR, oklabDistance, sameHue, softFoot } from '../band-foot'

describe('band-foot', () => {
  it('measures colours apart in OKLab, in hex or oklch', () => {
    expect(oklabDistance('#ffffff', '#ffffff')).toBe(0)
    expect(oklabDistance('#000000', '#ffffff')).toBeCloseTo(1, 1)
    expect(oklabDistance('oklch(0.5 0.1 250)', 'oklch(0.5 0.1 250)')).toBe(0)
    expect(oklabDistance('not a colour', '#ffffff')).toBe(Infinity)
  })

  it('finds one hue family only between coloured surfaces', () => {
    expect(sameHue('#3a3fd0', '#131573')).toBe(true)
    expect(sameHue('#3a3fd0', '#ffffff')).toBe(false)
    expect(sameHue('#0a0a0a', '#111111')).toBe(false)
    expect(sameHue('#f38020', '#3a3fd0')).toBe(false)
  })

  it('fades a band near the page or of its hue, and keeps a far one’s edge', () => {
    expect(fadesIntoPage(['#3a3fd0'], '#131573')).toBe(true)
    expect(fadesIntoPage(['#0c1a2a'], '#0a0a0a')).toBe(true)
    expect(fadesIntoPage(['#fde9db'], '#ffffff')).toBe(true)
    expect(fadesIntoPage(['#9fe870'], '#ffffff')).toBe(false)
    expect(fadesIntoPage(['#f38020'], '#ffffff')).toBe(false)
    expect(fadesIntoPage(['#4a1942'], '#ffffff')).toBe(false)
    expect(NEAR).toBeGreaterThan(0)
  })

  it('fades over 6rem only where every text on the band reads on the page too', () => {
    expect(softFoot('#ffffff', ['#111111']).paint).toContain('calc(100% - 6rem)')
    expect(softFoot('#ffffff', ['#ffffff'])).toEqual({
      paint: 'none',
      pad: '#ffffff',
      fadeOut: false,
    })
  })
})
