/**
 * The logo cutout on synthetic headers with known answers: the mark's own
 * components are kept and neighbouring menu text left out, a clipped box is
 * recovered, the header colour is removed with soft edges, letter counters
 * open while a symbol's large inner face stays, the kind follows geometry and
 * the finder's reading, a single ink that vanishes on a header asks for a
 * tile, and a dimmed screenshot is never the source when a clean one exists.
 */
import { describe, expect, it } from 'vitest'
import { deltaE00, type RGB } from '../color'
import type { Box } from '../kinds'
import { cutLogo, type LogoCut } from '../logo'
import {
  chooseLogoSource,
  logoKind,
  logoOneInk,
  logoPlacement,
  logoTile,
  noiseInk,
} from '../logo-choice'
import { decodePng, type Image } from '../png'
import { roundOutline } from './shapes'

function canvas(width: number, height: number, c: RGB): Image {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([c[0], c[1], c[2], 255], i * 4)
  return { width, height, data }
}
function rect(img: Image, [x0, y0, x1, y1]: Box, c: RGB) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}
/** A letter-like block with a counter (a hole in the background colour). */
function letter(img: Image, x: number, y: number, w: number, h: number, ink: RGB, bg: RGB) {
  rect(img, [x, y, x + w, y + h], ink)
  rect(img, [x + 3, y + 4, x + w - 3, y + h - 4], bg)
}
const alphaAt = (cut: LogoCut, x: number, y: number) => {
  // Source-image coordinates to cutout coordinates.
  const cx = x - cut.origin[0]
  const cy = y - cut.origin[1]
  return cut.image.data[(cy * cut.image.width + cx) * 4 + 3]!
}

const WHITE: RGB = [255, 255, 255]
const INK: RGB = [10, 20, 40]
const GREEN: RGB = [159, 232, 112]
const RED: RGB = [255, 79, 64]

/** A header: a five-letter wordmark at x 40..140, menu words from x 180. */
function header(bg: RGB, ink: RGB): Image {
  const img = canvas(400, 80, bg)
  for (let i = 0; i < 5; i++) letter(img, 40 + i * 21, 28, 18, 24, ink, bg)
  for (let i = 0; i < 4; i++) rect(img, [180 + i * 12, 34, 189 + i * 12, 46], ink)
  return img
}

describe('cutLogo', () => {
  it('cuts the wordmark and leaves out a menu word the box runs into', () => {
    const img = header(WHITE, INK)
    const cut = cutLogo(img, [38, 26, 186, 54], { scale: 1 })!
    expect(cut.bounds).toEqual([40, 28, 142, 52])
    expect(cut.clean).toBe(true)
    // Background and counters transparent, ink opaque.
    expect(alphaAt(cut, 40, 28)).toBe(255)
    expect(alphaAt(cut, 50, 40)).toBe(0)
    expect(cut.image.width).toBeGreaterThan(102)
    // Padded: the corners are transparent.
    expect(cut.image.data[3]).toBe(0)
    expect(deltaE00(cut.palette[0]!.rgb, INK)).toBeLessThan(2)
    // A real PNG of the cutout.
    const back = decodePng(cut.png)
    expect([back.width, back.height]).toEqual([
      cut.image.width * cut.pngScale,
      cut.image.height * cut.pngScale,
    ])
  })

  it('recovers a mark the box clips', () => {
    const img = header(WHITE, INK)
    const cut = cutLogo(img, [44, 30, 120, 50], { scale: 1 })!
    expect(cut.bounds).toEqual([40, 28, 142, 52])
  })

  it('removes a coloured header and keeps only the ink colours', () => {
    const img = header(GREEN, INK)
    const cut = cutLogo(img, [40, 28, 142, 52], { scale: 1 })!
    expect(deltaE00(cut.background, GREEN)).toBeLessThan(1)
    expect(cut.palette.every((p) => deltaE00(p.rgb, GREEN) > 10)).toBe(true)
    expect(alphaAt(cut, 50, 40)).toBe(0)
  })

  it('gives anti-aliased edges soft alpha in the ink colour', () => {
    const img = header(WHITE, RED)
    // A half-covered column right of the first letter: 50% red over white.
    const mid: RGB = [255, 167, 160]
    rect(img, [58, 28, 59, 52], mid)
    const cut = cutLogo(img, [40, 28, 142, 52], { scale: 1 })!
    const a = alphaAt(cut, 58, 40)
    expect(a).toBeGreaterThan(80)
    expect(a).toBeLessThan(180)
    const o = ((40 - cut.origin[1]) * cut.image.width + (58 - cut.origin[0])) * 4
    const c: RGB = [cut.image.data[o]!, cut.image.data[o + 1]!, cut.image.data[o + 2]!]
    expect(deltaE00(c, RED)).toBeLessThan(6)
  })

  it("keeps a symbol's large inner face opaque", () => {
    const img = canvas(200, 80, WHITE)
    // A square outline 30px with a white face (like a cube or a badge).
    rect(img, [20, 20, 50, 50], INK)
    rect(img, [23, 23, 47, 47], WHITE)
    rect(img, [30, 30, 40, 40], INK)
    const cut = cutLogo(img, [20, 20, 50, 50], { scale: 1 })!
    expect(alphaAt(cut, 25, 25)).toBe(255)
    expect(logoKind(cut)).toBe('icon')
  })

  it('reads a white logo on a dark header as needing a dark tile', () => {
    const img = header([12, 12, 12], WHITE)
    const cut = cutLogo(img, [40, 28, 142, 52], { scale: 1 })!
    expect(cut.readsOnDark).toBe(true)
    expect(cut.readsOnLight).toBe(false)
    expect(logoTile(cut, WHITE)).toBe('dark')
    expect(logoTile(cut, [20, 30, 60])).toBeNull()
  })

  it('reads by its outline: a framed yellow reads on white, a dark name does not read on dark', () => {
    const framed = canvas(200, 80, WHITE)
    rect(framed, [20, 20, 120, 60], [0, 88, 166])
    rect(framed, [30, 28, 110, 52], [255, 219, 0])
    const a = cutLogo(framed, [20, 20, 120, 60], { scale: 1 })!
    expect(a.readsOnLight).toBe(true)
    expect(a.readsOnDark).toBe(true)

    const named = canvas(300, 80, WHITE)
    rect(named, [20, 20, 52, 52], [255, 200, 0])
    for (let i = 0; i < 5; i++) letter(named, 64 + i * 16, 28, 13, 18, INK, WHITE)
    const b = cutLogo(named, [20, 20, 144, 52], { scale: 1 })!
    expect(b.readsOnLight).toBe(true)
    expect(b.readsOnDark).toBe(false)
    expect(logoTile(b, [18, 18, 18])).toBe('light')
  })

  it('tells a logo of one ink, which can be redrawn in white or black, from one of several', () => {
    const black = cutLogo(header(WHITE, INK), [40, 28, 142, 52], { scale: 1 })!
    expect(logoOneInk(black)).toBe(true)
    const white = cutLogo(header([12, 12, 12], WHITE), [40, 28, 142, 52], { scale: 1 })!
    expect(logoOneInk(white)).toBe(true)
    // A coloured symbol beside a black name: two inks.
    const named = canvas(300, 80, WHITE)
    rect(named, [20, 20, 52, 52], RED)
    for (let i = 0; i < 5; i++) letter(named, 64 + i * 16, 28, 13, 18, INK, WHITE)
    expect(logoOneInk(cutLogo(named, [20, 20, 144, 52], { scale: 1 })!)).toBe(false)
  })

  it('takes a black mark with a white face inside as one ink, to be reversed whole', () => {
    // A black square with a white face and a black letter in it, on a white page that is
    // removed: black and white, no colour, so reversed it reads as the brand's reversed logo.
    const img = canvas(200, 80, [240, 240, 240])
    rect(img, [20, 20, 60, 60], [0, 0, 0])
    rect(img, [24, 24, 56, 56], WHITE)
    rect(img, [34, 30, 46, 50], [0, 0, 0])
    for (let i = 0; i < 4; i++) letter(img, 70 + i * 16, 30, 13, 20, [0, 0, 0], [240, 240, 240])
    const cut = cutLogo(img, [20, 20, 134, 60], { scale: 1 })!
    expect(cut.palette.length).toBeGreaterThan(1)
    expect(logoOneInk(cut)).toBe(true)
  })

  it('cuts a white wordmark over a photo, following it past a short box in a centred header', () => {
    // A blurred photo behind a centred header: brown and purple, varying smoothly.
    const W = 740
    const img = canvas(W, 120, WHITE)
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < W; x++) {
        const t = x / W
        const w = Math.sin(x / 7) * Math.cos(y / 5)
        const c: RGB = [
          Math.round(124 + 50 * t + 30 * w),
          Math.round(79 + 20 * Math.sin(y / 17) + 12 * w),
          Math.round(58 + 70 * t - 10 * w),
        ]
        img.data.set([...c, 255], (y * W + x) * 4)
      }
    // Seven outlined capitals at x 300..440, menu words in white far to each side.
    const bar = (b: Box) => rect(img, b, WHITE)
    for (let i = 0; i < 7; i++) {
      const x = 300 + i * 20
      bar([x, 48, x + 3, 72])
      bar([x + 13, 48, x + 16, 72])
      bar([x, 48, x + 16, 51])
      bar([x, 69, x + 16, 72])
    }
    for (let i = 0; i < 4; i++) bar([40 + i * 14, 56, 50 + i * 14, 64])
    for (let i = 0; i < 4; i++) bar([640 + i * 14, 56, 650 + i * 14, 64])
    // The finder's box stops after the fifth letter.
    const cut = cutLogo(img, [298, 47, 396, 73], { scale: 1 })!
    expect(cut.clean).toBe(true)
    expect(cut.bounds[0]).toBe(300)
    expect(cut.bounds[2]).toBe(436)
    expect(cut.bounds[1]).toBe(48)
    expect(cut.bounds[3]).toBe(72)
    // Its ink is read off the photo, too rough to redraw larger: it is kept at its size.
    expect(cut.pngScale).toBe(1)
    // The photo is removed: only the white ink is left, one ink, no brown.
    expect(deltaE00(cut.palette[0]!.rgb, WHITE)).toBeLessThan(3)
    expect(logoOneInk(cut)).toBe(true)
    expect(cut.palette.filter((p) => deltaE00(p.rgb, WHITE) > 10 && p.share > 0.02)).toEqual([])
    expect(alphaAt(cut, 306, 60)).toBe(0)
    expect(alphaAt(cut, 301, 60)).toBe(255)
  })

  it('follows a widely spaced wordmark past a short box in a centred header', () => {
    // Seven capitals 16px wide with 9px between them, centred at x 370; menu words far out.
    const img = canvas(740, 120, WHITE)
    for (let i = 0; i < 7; i++) letter(img, 286 + i * 25, 50, 16, 20, INK, WHITE)
    for (let i = 0; i < 4; i++) rect(img, [40 + i * 14, 56, 50 + i * 14, 64], INK)
    for (let i = 0; i < 4; i++) rect(img, [640 + i * 14, 56, 650 + i * 14, 64], INK)
    // The finder's box stops after the fifth letter.
    const cut = cutLogo(img, [285, 49, 403, 71], { scale: 1 })!
    expect(cut.bounds).toEqual([286, 50, 452, 70])
  })

  it('does not take the menu beside a logo as more of the wordmark', () => {
    const img = canvas(740, 120, WHITE)
    for (let i = 0; i < 4; i++) letter(img, 40 + i * 25, 50, 16, 20, INK, WHITE)
    // Menu words of the same height, a clear gap after the logo.
    for (let i = 0; i < 3; i++) letter(img, 190 + i * 20, 50, 16, 20, INK, WHITE)
    const cut = cutLogo(img, [39, 49, 132, 71], { scale: 1 })!
    expect(cut.bounds).toEqual([40, 50, 131, 70])
  })

  it("cuts a white wordmark on a dark gradient's grain, leaving the grain behind", () => {
    // Near-black with grain (0 to 2), glowing toward the bottom right, a few brighter specks:
    // in OKLab, near-black values lie far apart, so every grain looks like ink.
    const img = canvas(600, 240, [1, 1, 1])
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 600; x++) {
        const h = Math.imul(x * 7919 + y * 104729, 2654435761) >>> 24
        const v = Math.round((h % 3) + (x / 600) * 12 + (y / 240) * 6 + (h > 250 ? 14 : 0))
        img.data.set([v, v, v, 255], (y * 600 + x) * 4)
      }
    for (let i = 0; i < 5; i++) letter(img, 40 + i * 21, 28, 18, 24, [240, 240, 240], [1, 1, 1])
    const cut = cutLogo(img, [34, 20, 150, 60], { scale: 1 })!
    expect(cut.clean).toBe(true)
    expect(cut.bounds[0]).toBeGreaterThanOrEqual(36)
    expect(cut.bounds[1]).toBeGreaterThanOrEqual(24)
    expect(cut.bounds[2]).toBeLessThanOrEqual(146)
    expect(cut.bounds[3]).toBeLessThanOrEqual(56)
    expect(cut.components).toBeLessThanOrEqual(5)
    expect(deltaE00(cut.palette[0]!.rgb, [240, 240, 240])).toBeLessThan(3)
    expect(chooseLogoSource([{ image: img, box: [34, 20, 150, 60] }])).not.toBeNull()
  })

  it('leaves out a framed badge beside the wordmark: site chrome, not the mark', () => {
    // A star-count pill just past the wordmark, closer than the letters' grouping gap.
    const img = header(WHITE, INK)
    rect(img, [180, 34, 240, 46], WHITE)
    roundOutline(img, [148, 30, 204, 50], 10, 2, INK)
    rect(img, [158, 36, 164, 44], INK)
    rect(img, [170, 36, 176, 44], INK)
    const cut = cutLogo(img, [38, 26, 150, 54], { scale: 1 })!
    expect(cut.bounds).toEqual([40, 28, 142, 52])
    // A framed symbol inside the box is still the mark.
    const framed = canvas(200, 80, WHITE)
    roundOutline(framed, [20, 20, 60, 60], 10, 3, INK)
    rect(framed, [32, 32, 48, 48], INK)
    expect(cutLogo(framed, [20, 20, 60, 60], { scale: 1 })!.bounds).toEqual([20, 20, 60, 60])
  })

  it('leaves out black grain touching a white name on a near-black header', () => {
    // Grain of 1 and 2 everywhere, black dots among it, some against the letters' edges.
    const img = canvas(400, 80, [1, 1, 1])
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 400; x++) {
        const h = Math.imul(x * 7919 + y * 104729, 2654435761) >>> 24
        const v = h < 30 ? 0 : 1 + (h % 2)
        img.data.set([v, v, v, 255], (y * 400 + x) * 4)
      }
    for (let i = 0; i < 5; i++) {
      letter(img, 40 + i * 21, 28, 18, 24, [240, 240, 240], [1, 1, 1])
      rect(img, [58 + i * 21, 30, 59 + i * 21, 31], [0, 0, 0])
      rect(img, [45 + i * 21, 27, 46 + i * 21, 28], [0, 0, 0])
    }
    const cut = cutLogo(img, [38, 26, 144, 54], { scale: 1 })!
    expect(cut.bounds).toEqual([40, 28, 142, 52])
    const { data } = cut.image
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3]! > 32) expect(data[i]!).toBeGreaterThan(100)
  })

  it('draws a flat cut at a higher resolution with crisp edges, keeping a faint hairline', () => {
    const img = header(WHITE, INK)
    // A soft edge on each letter (half-covered columns) and a faint hairline under the name.
    const half: RGB = [133, 138, 148]
    for (let i = 0; i < 5; i++) rect(img, [58 + i * 21, 28, 59 + i * 21, 52], half)
    rect(img, [40, 55, 140, 56], [180, 183, 190])
    const cut = cutLogo(img, [38, 26, 144, 58], { scale: 1 })!
    const png = decodePng(cut.png)
    expect(cut.pngScale).toBeGreaterThanOrEqual(3)
    expect([png.width, png.height]).toEqual([
      cut.image.width * cut.pngScale,
      cut.image.height * cut.pngScale,
    ])
    // Few half-clear pixels: the letters' edges are a pixel wide at the new size.
    let soft = 0
    let ink = 0
    for (let i = 3; i < png.data.length; i += 4) {
      if (png.data[i]! > 0) ink++
      if (png.data[i]! > 40 && png.data[i]! < 215) soft++
    }
    expect(soft / ink).toBeLessThan(0.2)
    // The hairline is still there.
    const k = cut.pngScale
    const hy = Math.round((55.5 - cut.origin[1]) * k)
    let line = 0
    for (let x = 0; x < png.width; x++)
      line = Math.max(line, png.data[(hy * png.width + x) * 4 + 3]!)
    expect(line).toBeGreaterThan(60)
  })

  it('keeps a cut of hairline strokes at its size: too fine to redraw faithfully', () => {
    const img = canvas(400, 80, WHITE)
    // Five open letters drawn in 1px lines.
    for (let i = 0; i < 5; i++) {
      const x = 40 + i * 21
      rect(img, [x, 28, x + 18, 29], INK)
      rect(img, [x, 51, x + 18, 52], INK)
      rect(img, [x, 28, x + 1, 52], INK)
      rect(img, [x + 17, 28, x + 18, 52], INK)
    }
    const cut = cutLogo(img, [38, 26, 144, 54], { scale: 1 })!
    expect(cut.pngScale).toBe(1)
    // The same letters in 4px strokes are redrawn.
    expect(cutLogo(header(WHITE, INK), [38, 26, 144, 54], { scale: 1 })!.pngScale).toBeGreaterThan(
      1
    )
  })

  it('reports a busy background as not clean', () => {
    const img = canvas(200, 80, WHITE)
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 200; x++)
        img.data.set([(x * 37) % 256, (y * 53) % 256, ((x + y) * 19) % 256, 255], (y * 200 + x) * 4)
    const cut = cutLogo(img, [20, 20, 80, 50], { scale: 1 })!
    expect(cut.clean).toBe(false)
  })
})

describe('logoKind and placement', () => {
  it('a wordmark becomes the full logo', () => {
    const cut = cutLogo(header(WHITE, INK), [40, 28, 142, 52], { scale: 1 })!
    expect(logoKind(cut)).toBe('wordmark')
    expect(logoPlacement(cut, 'wordmark')).toMatchObject({ kind: 'wordmark', use: 'full_logo' })
  })

  it('a leading symbol then a name is icon and name, placed as the full logo', () => {
    const img = canvas(300, 80, WHITE)
    rect(img, [20, 20, 52, 52], RED)
    for (let i = 0; i < 5; i++) letter(img, 64 + i * 16, 28, 13, 18, INK, WHITE)
    const cut = cutLogo(img, [20, 20, 144, 52], { scale: 1 })!
    expect(logoKind(cut)).toBe('icon_and_name')
    expect(logoPlacement(cut, 'icon_and_name').use).toBe('full_logo')
  })

  it('a square mark is an icon with the title, whatever the reading says', () => {
    const img = canvas(200, 80, WHITE)
    rect(img, [20, 20, 50, 50], RED)
    const cut = cutLogo(img, [20, 20, 50, 50], { scale: 1 })!
    expect(logoPlacement(cut, 'wordmark')).toMatchObject({ kind: 'icon', use: 'icon_and_title' })
  })
})

describe('chooseLogoSource', () => {
  const dim = (img: Image, k: number): Image => {
    const data = new Uint8Array(img.data)
    for (let i = 0; i < data.length; i += 4)
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c]! * k)
    return { width: img.width, height: img.height, data }
  }
  const box: Box = [40, 28, 142, 52]

  it('never cuts from a dimmed image when a clean one exists, flagged or measured', () => {
    const clean = header(WHITE, RED)
    const dark = dim(clean, 0.7)
    expect(
      chooseLogoSource([
        { image: dark, box },
        { image: clean, box },
      ])!.index
    ).toBe(1)
    expect(
      chooseLogoSource([
        { image: clean, box, dimmed: true },
        { image: header(WHITE, RED), box },
      ])!.index
    ).toBe(1)
  })

  it('prefers the sharper capture among clean ones', () => {
    const small = header(WHITE, INK)
    const big = canvas(800, 160, WHITE)
    for (let i = 0; i < 5; i++) letter(big, 80 + i * 42, 56, 36, 48, INK, WHITE)
    const pick = chooseLogoSource([
      { image: small, box },
      { image: big, box: [80, 56, 284, 104] },
    ])!
    expect(pick.index).toBe(1)
  })

  it('never takes a cut whose ink is noise: scattered specks, no shape', () => {
    // Dark, with small bright blobs scattered everywhere and no mark at all.
    const img = canvas(400, 160, [12, 12, 12])
    for (let y = 2; y < 156; y += 5)
      for (let x = 2; x < 396; x += 5) {
        const h = Math.imul(x * 31 + y * 17, 2654435761) >>> 28
        if (h < 10)
          rect(img, [x + (h % 2), y + (h % 2), x + (h % 2) + 2, y + (h % 2) + 3], [90, 90, 90])
      }
    const cut = cutLogo(img, [40, 28, 142, 52], { scale: 1 })
    expect(cut && noiseInk(cut)).toBe(true)
    expect(chooseLogoSource([{ image: img, box: [40, 28, 142, 52] }])).toBeNull()
    // A real wordmark is never noise.
    expect(noiseInk(cutLogo(header(WHITE, INK), box, { scale: 1 })!)).toBe(false)
  })

  it('never takes a portrait cut read as a word: a rotated or stacked name is a sliver in a header', () => {
    const img = canvas(200, 400, WHITE)
    for (let i = 0; i < 5; i++) letter(img, 40, 40 + i * 60, 40, 50, INK, WHITE)
    const box: Box = [40, 40, 80, 330]
    expect(chooseLogoSource([{ image: img, box, kind: 'wordmark' }])).toBeNull()
    // A tall symbol is still an icon.
    expect(chooseLogoSource([{ image: img, box, kind: 'icon' }])).not.toBeNull()
  })

  it('skips a source with no box', () => {
    expect(chooseLogoSource([{ image: header(WHITE, INK), box: null }])).toBeNull()
  })
})
