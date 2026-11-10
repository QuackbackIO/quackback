import { describe, expect, it } from 'vitest'
import { rasteriseSvg } from '../svg'

const svg = (body: string, box = '0 0 100 100') =>
  new TextEncoder().encode(
    `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`
  )

const at = (img: { width: number; data: Uint8Array }, x: number, y: number) => {
  const o = (y * img.width + x) * 4
  return [...img.data.subarray(o, o + 4)]
}

describe('rasteriseSvg', () => {
  it('draws a filled shape at the asked size, clear around it', () => {
    const img = rasteriseSvg(
      svg('<rect x="25" y="25" width="50" height="50" fill="#e11d48"/>'),
      200
    )!
    expect([img.width, img.height]).toEqual([200, 200])
    expect(at(img, 100, 100)).toEqual([0xe1, 0x1d, 0x48, 255])
    expect(at(img, 10, 10)[3]).toBe(0)
  })

  it('keeps the icon’s proportions, its longest side at the size', () => {
    const img = rasteriseSvg(svg('<rect width="200" height="100"/>', '0 0 200 100'), 128)!
    expect([img.width, img.height]).toEqual([128, 64])
    expect(at(img, 64, 32)).toEqual([0, 0, 0, 255])
  })

  it('reads paths with curves and arcs, transforms and class rules', () => {
    const img = rasteriseSvg(
      svg(
        '<style>.a{fill:#2563eb}</style>' +
          '<g transform="translate(50 50)"><path class="a" d="M-40 0a40 40 0 1 0 80 0a40 40 0 1 0-80 0z"/></g>'
      ),
      100
    )!
    expect(at(img, 50, 50)).toEqual([0x25, 0x63, 0xeb, 255])
    expect(at(img, 50, 15)[3]).toBe(255)
    expect(at(img, 3, 3)[3]).toBe(0)
  })

  it('leaves an even-odd hole clear', () => {
    const img = rasteriseSvg(
      svg('<path fill-rule="evenodd" d="M10 10H90V90H10Z M40 40H60V60H40Z"/>'),
      100
    )!
    expect(at(img, 20, 20)[3]).toBe(255)
    expect(at(img, 50, 50)[3]).toBe(0)
  })

  it('draws strokes, and a gradient as its first colour', () => {
    const img = rasteriseSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#16a34a"/><stop offset="1" stop-color="#000"/></linearGradient></defs>' +
          '<rect x="0" y="0" width="50" height="100" fill="url(#g)"/>' +
          '<line x1="75" y1="0" x2="75" y2="100" stroke="#f59e0b" stroke-width="10"/>'
      ),
      100
    )!
    expect(at(img, 25, 50)).toEqual([0x16, 0xa3, 0x4a, 255])
    expect(at(img, 75, 50)).toEqual([0xf5, 0x9e, 0x0b, 255])
    expect(at(img, 90, 50)[3]).toBe(0)
  })

  it('gives null for what it cannot draw faithfully or at all', () => {
    expect(rasteriseSvg(svg('<text x="0" y="50">Acme</text>'), 64)).toBeNull()
    expect(rasteriseSvg(svg('<image href="x.png" width="10" height="10"/>'), 64)).toBeNull()
    expect(rasteriseSvg(svg('<rect width="10" height="10" fill="none"/>'), 64)).toBeNull()
    expect(rasteriseSvg(new TextEncoder().encode('not svg'), 64)).toBeNull()
  })
})
