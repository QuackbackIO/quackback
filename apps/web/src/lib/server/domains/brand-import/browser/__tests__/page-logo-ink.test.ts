// @vitest-environment happy-dom
/**
 * Counting the inks a logo is drawn in. The drawing itself is the browser's;
 * here the image and the canvas are stood in for, and the counting is real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { measureLogoInk } from '../page-logo-ink'

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a]
function standIn(pixels: number[][], { loads = true, throws = false } = {}) {
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = 40
    naturalHeight = 10
    set src(_value: string) {
      queueMicrotask(() => (loads ? this.onload?.() : this.onerror?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
  const drawn: number[][] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: (_image: unknown, ...at: number[]) => drawn.push(at),
    getImageData: () => {
      if (throws) throw new Error('tainted')
      return { data: Uint8ClampedArray.from(pixels.flat()) }
    },
  } as never)
  return drawn
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('measureLogoInk', () => {
  it('gives each ink with the share of the logo it draws, most first, see-through pixels left out', async () => {
    standIn([
      ...Array.from({ length: 6 }, () => px(255, 255, 255)),
      ...Array.from({ length: 3 }, () => px(48, 105, 152)),
      px(255, 212, 59),
      ...Array.from({ length: 30 }, () => px(0, 0, 0, 0)),
    ])
    expect(await measureLogoInk('data:image/png;base64,AAAA', 200, 50)).toMatchObject([
      { color: '#ffffff', share: 0.6 },
      { color: '#306998', share: 0.3 },
      { color: '#ffd43b', share: 0.1 },
    ])
  })

  it('counts near shades as one ink and a soft edge for less than a solid pixel', async () => {
    standIn([px(250, 250, 250), px(255, 255, 255), px(10, 10, 10, 128)])
    const inks = await measureLogoInk('data:image/png;base64,AAAA', 20, 20)
    expect(inks).toHaveLength(2)
    expect(inks![0]!.share).toBeCloseTo(0.8, 1)
  })

  it('says where in the logo each ink is drawn, as shares of its width and height', async () => {
    // A 160 by 40 drawing: a blue mark in the first 32 columns, a white word after column 40.
    const row = (y: number) =>
      Array.from({ length: 160 }, (_, x) =>
        x < 32
          ? px(48, 105, 152)
          : x >= 40 && y >= 10 && y < 30
            ? px(255, 255, 255)
            : px(0, 0, 0, 0)
      )
    standIn(Array.from({ length: 40 }, (_, y) => row(y)).flat())
    const inks = await measureLogoInk('data:image/png;base64,AAAA', 160, 40)
    expect(inks!.find((ink) => ink.color === '#ffffff')!.box).toEqual([0.25, 0.25, 1, 0.75])
    expect(inks!.find((ink) => ink.color === '#306998')!.box).toEqual([0, 0, 0.2, 1])
  })

  it('marks the ink at all four corners as the picture’s own ground', async () => {
    const grid = (ground: number[]) =>
      Array.from({ length: 40 * 160 }, (_, i) => {
        const [x, y] = [i % 160, Math.floor(i / 160)]
        return x > 40 && x < 120 && y > 10 && y < 30 ? px(1, 1, 1) : ground
      })
    standIn(grid(px(255, 255, 255)))
    const plated = await measureLogoInk('data:image/png;base64,AAAA', 160, 40)
    expect(plated!.find((ink) => ink.color === '#ffffff')!.plate).toBe(true)
    expect(plated!.find((ink) => ink.color === '#010101')!.plate).toBeUndefined()
    standIn(grid(px(0, 0, 0, 0)))
    const bare = await measureLogoInk('data:image/png;base64,AAAA', 160, 40)
    expect(bare!.some((ink) => ink.plate)).toBe(false)
  })

  it('draws no larger than it needs, keeping the logo’s shape', async () => {
    const drawn = standIn([px(0, 0, 0)])
    await measureLogoInk('data:image/png;base64,AAAA', 640, 160)
    expect(drawn[0]).toEqual([0, 0, 160, 40])
  })

  it('reads as null when the picture will not load or its pixels may not be read', async () => {
    standIn([px(0, 0, 0)], { loads: false })
    expect(await measureLogoInk('data:image/png;base64,AAAA', 20, 20)).toBeNull()
    standIn([px(0, 0, 0)], { throws: true })
    expect(await measureLogoInk('data:image/png;base64,AAAA', 20, 20)).toBeNull()
  })

  it('has no inks for a picture with nothing drawn in it', async () => {
    standIn([px(0, 0, 0, 0)])
    expect(await measureLogoInk('data:image/png;base64,AAAA', 20, 20)).toEqual([])
  })
})
