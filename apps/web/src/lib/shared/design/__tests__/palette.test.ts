/**
 * The colours of a logo or a screenshot, read in the browser so no image
 * leaves it: the most used colours first, near neighbours merged, and
 * transparent pixels ignored.
 */
import { describe, expect, it } from 'vitest'
import { paletteFromPixels } from '../palette'

/** RGBA pixels: each entry repeated `count` times. */
function pixels(...runs: Array<[number, number, number, number, number]>) {
  const out: number[] = []
  for (const [r, g, b, a, count] of runs) for (let i = 0; i < count; i++) out.push(r, g, b, a)
  return new Uint8ClampedArray(out)
}

describe('paletteFromPixels', () => {
  it('lists the most used colours first, as hex', () => {
    const data = pixels([122, 31, 53, 255, 60], [255, 255, 255, 255, 30], [15, 118, 110, 255, 10])
    expect(paletteFromPixels(data, 3)).toEqual(['#7a1f35', '#ffffff', '#0f766e'])
  })

  it('merges colours that differ by a shade', () => {
    const data = pixels([122, 31, 53, 255, 20], [124, 33, 55, 255, 20], [15, 118, 110, 255, 10])
    const palette = paletteFromPixels(data, 3)
    expect(palette).toHaveLength(2)
    expect(palette[1]).toBe('#0f766e')
  })

  it('ignores transparent pixels', () => {
    const data = pixels([0, 0, 0, 0, 100], [245, 179, 1, 255, 5])
    expect(paletteFromPixels(data, 3)).toEqual(['#f5b301'])
  })

  it('gives nothing for an empty image', () => {
    expect(paletteFromPixels(new Uint8ClampedArray(), 3)).toEqual([])
  })
})
