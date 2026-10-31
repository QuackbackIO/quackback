/**
 * The colours of a logo or a screenshot, read in the browser: the brand
 * colour first, then the most used, near neighbours merged and transparent
 * pixels ignored. A deep brand colour counts as much as a bright one.
 */
import { describe, expect, it } from 'vitest'
import { brandColour, isBrandColour, paletteFromPixels } from '../palette'

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

  it('keeps the most vivid colour that has a real share, even when it is rarely used', () => {
    // A screenshot: mostly white and peach, with a coral button.
    const data = pixels(
      [255, 255, 255, 255, 500],
      [255, 240, 232, 255, 400],
      [245, 245, 245, 255, 300],
      [230, 230, 230, 255, 200],
      [255, 90, 54, 255, 30],
      [255, 0, 255, 255, 1]
    )
    const palette = paletteFromPixels(data, 3)
    expect(palette).toHaveLength(3)
    expect(palette).toContain('#ff5a36')
    expect(palette).not.toContain('#ff00ff')
    expect(brandColour(palette)).toBe('#ff5a36')
    expect(palette[0]).toBe('#ff5a36')
  })

  it('finds a brand colour spread thin across shades, as on a small button', () => {
    // Anti-aliasing splits a coral button into near shades, none common.
    const data = pixels(
      [255, 255, 255, 255, 2000],
      [255, 233, 223, 255, 600],
      [200, 200, 200, 255, 300],
      [120, 120, 120, 255, 200],
      [222, 75, 43, 255, 3],
      [215, 71, 39, 255, 3],
      [225, 77, 45, 255, 3],
      [233, 83, 50, 255, 3]
    )
    const palette = paletteFromPixels(data, 3)
    const vivid = brandColour(palette)
    expect(vivid).not.toBeNull()
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(vivid!.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(100)
    expect(b).toBeLessThan(60)
  })

  it('takes a deep brand colour that covers the page over a brighter accent used once', () => {
    // A cream page with pine-green headings and buttons and one copper heading.
    const data = pixels(
      [246, 239, 226, 255, 3000],
      [255, 250, 240, 255, 800],
      [31, 77, 58, 255, 400],
      [180, 100, 43, 255, 60],
      [34, 32, 28, 255, 300]
    )
    const palette = paletteFromPixels(data, 4)
    expect(palette[0]).toBe('#1f4d3a')
    expect(brandColour(palette)).toBe('#1f4d3a')
  })

  it('counts deep colours as brand colours, and greys, whites and near-blacks not', () => {
    expect(['#1f4d3a', '#4a154b', '#0b3d91', '#ff5a36'].map(isBrandColour)).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(['#6b7280', '#f6efe2', '#0b1020', '#ffffff'].map(isBrandColour)).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it('gives nothing for an empty image', () => {
    expect(paletteFromPixels(new Uint8ClampedArray(), 3)).toEqual([])
  })
})
