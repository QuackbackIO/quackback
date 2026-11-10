/**
 * The hero's layout measured from boxes: left-aligned words share a left
 * edge even when the headline's box happens to sit near the page's middle;
 * centred words share a centre; the room around the words sets the height;
 * a picture's place is where it sits against the words.
 */
import { describe, expect, it } from 'vitest'
import { heroLayout } from '../hero-geometry'

const W = 1440
const H = 900

describe('hero layout', () => {
  it('reads left-aligned words that share a left edge, though the headline spans the middle', () => {
    const out = heroLayout({
      width: W,
      height: H,
      boxes: {
        header: [0, 0, W, 76],
        hero: [0, 76, W, 760],
        headline: [208, 255, 1129, 482],
        primary_button: [208, 519, 349, 567],
        secondary_button: [357, 519, 569, 567],
      },
    })
    expect(out.align).toBe('left')
    expect(out.height).toBe('roomy')
  })

  it('reads centred words, with two buttons as one row', () => {
    const out = heroLayout({
      width: W,
      height: H,
      boxes: {
        header: [0, 0, W, 70],
        hero: [0, 70, W, 640],
        headline: [292, 125, 1148, 410],
        subtitle: [431, 424, 1009, 476],
        primary_button: [501, 497, 762, 545],
        secondary_button: [778, 497, 940, 545],
      },
    })
    expect(out.align).toBe('centre')
    expect(out.height).toBe('roomy')
  })

  it('takes a lone headline away from the middle as left, and a short hero as compact', () => {
    const out = heroLayout({
      width: W,
      height: H,
      boxes: { header: [0, 0, W, 200], hero: [0, 250, W, 380], headline: [49, 300, 352, 322] },
    })
    expect(out).toMatchObject({ align: 'left', height: 'compact', picture: null })
  })

  it('ignores a button in the header', () => {
    const out = heroLayout({
      width: W,
      height: H,
      boxes: {
        header: [0, 0, W, 70],
        hero: [0, 70, W, 900],
        headline: [474, 156, 979, 291],
        subtitle: [493, 323, 947, 341],
        primary_button: [1271, 12, 1376, 56],
      },
    })
    expect(out.align).toBe('centre')
    expect(out.height).toBe('tall')
  })

  it('places a product picture beside, below or behind the words', () => {
    const base = {
      header: [0, 0, W, 70],
      hero: [0, 70, W, 800],
      headline: [100, 160, 600, 360],
    } satisfies Record<string, [number, number, number, number]>
    const at = (product_screenshot: [number, number, number, number]) =>
      heroLayout({ width: W, height: H, boxes: { ...base, product_screenshot } }).picture
    expect(at([800, 120, 1400, 600])).toBe('side')
    expect(at([100, 420, 1300, 900])).toBe('edge')
    expect(at([0, 80, W, 800])).toBe('cover')
    expect(at([100, 950, 1300, 1400])).toBeNull()
  })
})
