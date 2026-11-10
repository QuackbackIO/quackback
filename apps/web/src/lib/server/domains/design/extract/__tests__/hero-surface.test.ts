/**
 * The hero's surface on synthetic heroes with known answers: a wide gradient
 * whose tiles each look flat, a pale wash in a corner, a solid band, flat
 * tonal shapes, a diagonal ribbon and a soft glow beside the words, a
 * gradient under them, and a saturated band in no brand colour.
 */
import { describe, expect, it } from 'vitest'
import { deltaE00, type RGB } from '../color'
import { heroSurface } from '../hero-surface'
import { surfaceMap, sweepOf } from '../surfaces'
import type { Box } from '../kinds'
import type { Image } from '../png'

type Fill = [number, number, number]
const W = 1440
const H = 640
const WHITE: Fill = [255, 255, 255]
const INK: Fill = [17, 17, 17]
const TEAL: Fill = [15, 181, 174]
const VIOLET: Fill = [109, 40, 217]
const ORANGE: Fill = [249, 115, 22]

const mix = (a: Fill, b: Fill, t: number): Fill => {
  const k = Math.min(1, Math.max(0, t))
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * k)) as Fill
}

function canvas(width: number, height: number, bg: (x: number, y: number) => Fill): Image {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([...bg(x, y), 255], (y * width + x) * 4)
  return { width, height, data }
}

/** Lines of words: vertical strokes 3px wide every 9px, as heavy type draws. */
function words(img: Image, [x0, y0, x1, y1]: Box, ink: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if ((x - x0) % 9 < 3 && (y - y0) % 40 < 30)
        img.data.set([...ink, 255], (y * img.width + x) * 4)
}

const HEADLINE_LEFT: Box = [96, 200, 640, 320]
const HEADLINE_CENTRE: Box = [400, 200, 1040, 320]
const hero: Box = [0, 0, W, H]
const hexToRgb = (h: string): RGB =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB

describe('sweepOf', () => {
  it('reads a wide two-hue gradient as a sweep, though each tile looks flat', () => {
    const img = canvas(W, H, (x, y) => mix(TEAL, VIOLET, (x + y * 0.5) / (W + H * 0.5)))
    const s = sweepOf(surfaceMap(img, hero, 8))
    expect(s.vivid).toBeGreaterThan(0.8)
  })

  it('leaves a pale wash in a corner out of the vivid sweep', () => {
    const LAVENDER: Fill = [236, 214, 252]
    const img = canvas(W, H, (x, y) =>
      mix(WHITE, LAVENDER, Math.max(0, 1 - Math.hypot(W - x, H - y) / 700))
    )
    const s = sweepOf(surfaceMap(img, hero, 8))
    expect(s.vivid).toBeLessThan(0.05)
  })

  it('finds no sweep in a solid band or in flat shapes of one hue', () => {
    expect(
      sweepOf(
        surfaceMap(
          canvas(W, H, () => TEAL),
          hero,
          8
        )
      ).share
    ).toBe(0)
    const tones: Fill[] = [
      [30, 60, 160],
      [60, 100, 210],
      [120, 160, 240],
    ]
    const shapes = canvas(W, H, (x) => tones[Math.floor(x / 480)]!)
    expect(sweepOf(surfaceMap(shapes, hero, 8)).share).toBeLessThan(0.05)
  })
})

describe('heroSurface', () => {
  it('reads a diagonal ribbon beside the words as a ribbon at the side', () => {
    const img = canvas(W, H, (x, y) => {
      const centre = W * (0.55 + 0.4 * (y / H))
      const d = Math.abs(x - centre) / (W * 0.12)
      return d >= 1
        ? WHITE
        : mix(mix(VIOLET, ORANGE, (x - centre) / (W * 0.24) + 0.5), WHITE, d * d)
    })
    words(img, HEADLINE_LEFT, INK)
    const s = heroSurface(img, { hero, headline: HEADLINE_LEFT })
    expect(s.gradient).toMatchObject({ place: 'side', form: 'ribbon' })
  })

  it('reads a soft glow beside the words as a mesh at the side', () => {
    const img = canvas(W, H, (x, y) =>
      mix(WHITE, VIOLET, Math.max(0, 1 - Math.hypot(x - 1150, y - 300) / 380) ** 1.2)
    )
    words(img, HEADLINE_LEFT, INK)
    const s = heroSurface(img, { hero, headline: HEADLINE_LEFT })
    expect(s.gradient).toMatchObject({ place: 'side', form: 'mesh' })
  })

  it('reads a gradient under the words as a linear fill', () => {
    const img = canvas(W, H, (x, y) => mix(TEAL, VIOLET, (x + y * 0.5) / (W + H * 0.5)))
    words(img, HEADLINE_CENTRE, WHITE)
    const s = heroSurface(img, { hero, headline: HEADLINE_CENTRE })
    expect(s.gradient).toMatchObject({ place: 'fill', form: 'linear' })
    expect(s.vivid).toBeGreaterThan(0.8)
  })

  it('reads a saturated band in any colour as bold, with its colour', () => {
    const img = canvas(W, H, () => [0, 121, 107])
    words(img, HEADLINE_CENTRE, WHITE)
    const s = heroSurface(img, { hero, headline: HEADLINE_CENTRE })
    expect(s.gradient).toBeNull()
    expect(s.vivid).toBeGreaterThan(0.8)
    expect(deltaE00([0, 121, 107], s.vividRgb as RGB)).toBeLessThan(3)
  })

  it('reads a solid orange panel lightening along its foot as one colour, not a gradient hero', async () => {
    const { agreedLook } = await import('../../ai/hero-rules')
    const AMBER: Fill = [252, 160, 90]
    const img = canvas(W, H, (_x, y) => mix(ORANGE, AMBER, (y - H * 0.8) / (H * 0.2)))
    words(img, HEADLINE_CENTRE, WHITE)
    const s = heroSurface(img, { hero, headline: HEADLINE_CENTRE })
    // Its foot sweeps, so the sweep alone would call it a gradient.
    expect(s.gradient?.share).toBeGreaterThan(0.12)
    expect(s.graphic?.share).toBeGreaterThan(0.6)
    // The measure read solid stays solid: the band is the panel's colour.
    expect(agreedLook('solid', s, 'solid_colour')).toBe('solid')
  })

  it('reads a deep navy band as bold too', () => {
    const img = canvas(W, H, () => [11, 42, 111])
    words(img, HEADLINE_CENTRE, WHITE)
    expect(heroSurface(img, { hero, headline: HEADLINE_CENTRE }).vivid).toBeGreaterThan(0.8)
  })

  it('reads a plain page with words and a colourful product picture as quiet', () => {
    const img = canvas(W, H, () => WHITE)
    words(img, HEADLINE_LEFT, INK)
    const shot: Box = [760, 80, 1400, 600]
    for (let y = shot[1]; y < shot[3]; y++)
      for (let x = shot[0]; x < shot[2]; x++) img.data.set([...VIOLET, 255], (y * W + x) * 4)
    const s = heroSurface(img, { hero, headline: HEADLINE_LEFT, product_screenshot: shot })
    expect(s.vivid).toBeLessThan(0.05)
    expect(s.gradient).toBeNull()
  })

  it('reads a coloured glow on a dark hero as a glow, in its colour', () => {
    const NIGHT: Fill = [12, 14, 22]
    const img = canvas(W, H, (x, y) =>
      mix(NIGHT, VIOLET, 0.8 * Math.max(0, 1 - Math.hypot(x - 1100, y - 260) / 520) ** 1.4)
    )
    words(img, HEADLINE_CENTRE, WHITE)
    const s = heroSurface(img, { hero, headline: HEADLINE_CENTRE })
    expect(s.glow?.share).toBeGreaterThan(0.15)
    expect(deltaE00(VIOLET, s.glow!.rgb as RGB)).toBeLessThan(25)
    expect(deltaE00(NIGHT, hexToRgb(s.glow!.base))).toBeLessThan(3)
  })

  it('finds no glow on a flat dark hero with a coloured button, nor on a deep navy page', () => {
    for (const bg of [
      [10, 10, 10],
      [11, 16, 32],
    ] as Fill[]) {
      const img = canvas(W, H, () => bg)
      words(img, HEADLINE_CENTRE, WHITE)
      const button: Box = [640, 380, 800, 424]
      for (let y = button[1]; y < button[3]; y++)
        for (let x = button[0]; x < button[2]; x++) img.data.set([...VIOLET, 255], (y * W + x) * 4)
      const s = heroSurface(img, { hero, headline: HEADLINE_CENTRE, primary_button: button })
      expect(s.glow).toBeNull()
    }
  })

  it('reads the glow on a dark hero whether or not the finder’s product box takes it in', () => {
    const NIGHT: Fill = [2, 2, 10]
    const BLUE: Fill = [40, 60, 230]
    const img = canvas(W, H, (x, y) =>
      mix(NIGHT, BLUE, 0.7 * Math.max(0, 1 - Math.hypot(x - 720, y - 420) / 420) ** 1.3)
    )
    words(img, [200, 80, 900, 160], WHITE)
    // The product's own card in the middle of the glow: flat, with its type.
    const card: Box = [560, 340, 880, 500]
    for (let y = card[1]; y < card[3]; y++)
      for (let x = card[0]; x < card[2]; x++) img.data.set([20, 28, 90, 255], (y * W + x) * 4)
    words(img, [580, 360, 860, 480], WHITE)
    const shares = [card, [120, 220, 1320, H] as Box, null].map(
      (product) =>
        heroSurface(img, { hero, headline: [200, 80, 900, 160], product_screenshot: product }).glow
          ?.share ?? 0
    )
    for (const share of shares) expect(share).toBeGreaterThan(0.12)
  })

  it('reads no glow from a product picture’s flat coloured interface on a dark hero', () => {
    const img = canvas(W, H, () => [10, 10, 12])
    words(img, HEADLINE_LEFT, WHITE)
    const shot: Box = [760, 80, 1400, 600]
    for (let y = shot[1]; y < shot[3]; y++)
      for (let x = shot[0]; x < shot[2]; x++)
        img.data.set([...(Math.floor(x / 60) % 2 ? VIOLET : TEAL), 255], (y * W + x) * 4)
    expect(
      heroSurface(img, { hero, headline: HEADLINE_LEFT, product_screenshot: shot }).glow
    ).toBeNull()
  })

  it('reads a flat dark section beside a photo, wherever the hero box starts', () => {
    const PANEL: Fill = [6, 8, 9]
    // A header strip, a photo (busy texture) on the left and a flat dark panel on the right.
    const img = canvas(W, H, (x, y) => {
      if (y < 64) return WHITE
      if (x >= 900) return PANEL
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      const v = 120 + Math.round((n - Math.floor(n)) * 120)
      return [v, v - 10, v - 20]
    })
    words(img, [96, 200, 500, 300], WHITE)
    for (const box of [[0, 0, W, H] as Box, [0, 64, W, H] as Box]) {
      const s = heroSurface(img, { hero: box, header: [0, 0, W, 64] })
      expect(s.darkSection?.share).toBeGreaterThan(0.3)
      expect(deltaE00(PANEL, s.darkSection!.rgb as RGB)).toBeLessThan(3)
    }
    // A photo with no dark panel has none.
    const plain = canvas(W, H, (x, y) => {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      const v = 120 + Math.round((n - Math.floor(n)) * 120)
      return [v, v - 10, v - 20]
    })
    expect(heroSurface(plain, { hero }).darkSection ?? null).toBeNull()
  })

  it('reads a photo hero’s tone: how dark it is overall, and the colour of its dark', () => {
    const noise = (x: number, y: number) => {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      return n - Math.floor(n)
    }
    // A dusky photo: warm shadows over most of it, a few lit patches.
    const dusk = canvas(W, H, (x, y) => {
      const v = noise(x, y) < 0.8 ? 30 + Math.round(noise(y, x) * 30) : 200
      return [v + 20, v, v - 10 < 0 ? 0 : v - 10]
    })
    words(dusk, HEADLINE_LEFT, WHITE)
    const dark = heroSurface(dusk, { hero, headline: HEADLINE_LEFT }).tone!
    expect(dark.lightness).toBeLessThan(0.5)
    // The dark is the shadows' warm colour, not the lit patches or the words.
    const [r, g, b] = hexToRgb(dark.dark)
    expect(r).toBeGreaterThan(b)
    expect(Math.max(r, g, b)).toBeLessThan(90)
    // A bright photo reads light.
    const day = canvas(W, H, (x, y) => {
      const v = 190 + Math.round(noise(x, y) * 60)
      return [v, v, v - 15]
    })
    expect(heroSurface(day, { hero }).tone!.lightness).toBeGreaterThan(0.75)
  })

  it('reads no glow on a light hero: a glow there is a gradient', () => {
    const img = canvas(W, H, (x, y) =>
      mix(WHITE, VIOLET, Math.max(0, 1 - Math.hypot(x - 1150, y - 300) / 380) ** 1.2)
    )
    words(img, HEADLINE_LEFT, INK)
    expect(heroSurface(img, { hero, headline: HEADLINE_LEFT }).glow).toBeNull()
  })

  it('reads a large graphic in one saturated colour as the hero’s graphic', () => {
    const GREEN: Fill = [20, 200, 80]
    const img = canvas(W, H, () => [22, 22, 22])
    words(img, HEADLINE_LEFT, WHITE)
    for (let y = 120; y < 520; y++)
      for (let x = 1000; x < 1260; x++)
        if ((x - 1000) % 130 < 90) img.data.set([...GREEN, 255], (y * W + x) * 4)
    const s = heroSurface(img, { hero, headline: HEADLINE_LEFT })
    expect(s.graphic?.share).toBeGreaterThan(0.06)
    expect(deltaE00(GREEN, s.graphic!.rgb as RGB)).toBeLessThan(5)
  })

  it('reads no graphic where the bold colour is many colours or the product’s picture', () => {
    const img = canvas(W, H, () => WHITE)
    words(img, HEADLINE_LEFT, INK)
    const shot: Box = [760, 80, 1400, 600]
    for (let y = shot[1]; y < shot[3]; y++)
      for (let x = shot[0]; x < shot[2]; x++) img.data.set([...VIOLET, 255], (y * W + x) * 4)
    expect(
      heroSurface(img, { hero, headline: HEADLINE_LEFT, product_screenshot: shot }).graphic
    ).toBeNull()
    const confetti = canvas(W, H, () => WHITE)
    const hues: Fill[] = [VIOLET, ORANGE, TEAL, [220, 30, 60]]
    for (let y = 100; y < 560; y++)
      for (let x = 900; x < 1380; x++)
        confetti.data.set(
          [...hues[(Math.floor(x / 40) + Math.floor(y / 40)) % 4]!, 255],
          (y * W + x) * 4
        )
    expect(heroSurface(confetti, { hero, headline: HEADLINE_LEFT }).graphic).toBeNull()
  })

  describe('whether the header shares the hero’s surface', () => {
    const HEADER: Box = [0, 0, W, 64]
    const BELOW: Box = [0, 64, W, H]
    const sweep = (x: number, y: number) => mix(TEAL, VIOLET, (x + y * 0.5) / (W + H * 0.5))

    it('a gradient running up behind the header joins it', () => {
      const img = canvas(W, H, sweep)
      words(img, [96, 20, 400, 44], WHITE)
      expect(heroSurface(img, { hero: BELOW, header: HEADER }).joinsHeader).toBe(true)
    })

    it('a ribbon reaching up behind a white header’s right side joins it', () => {
      const img = canvas(W, H, (x, y) => {
        const d = Math.abs(x - W * (0.75 + 0.2 * (y / H))) / (W * 0.15)
        return d >= 1 ? WHITE : mix(mix(VIOLET, ORANGE, y / H), WHITE, d * d)
      })
      expect(heroSurface(img, { hero: BELOW, header: HEADER }).joinsHeader).toBe(true)
    })

    it('a header in the hero’s solid colour joins it; a white one over it does not', () => {
      const LIME: Fill = [159, 232, 112]
      expect(
        heroSurface(
          canvas(W, H, () => LIME),
          { hero: BELOW, header: HEADER }
        ).joinsHeader
      ).toBe(true)
      const split = canvas(W, H, (_x, y) => (y < 64 ? WHITE : LIME))
      expect(heroSurface(split, { hero: BELOW, header: HEADER }).joinsHeader).toBe(false)
    })

    it('a rule under the header parts it from the gradient; a hairline over it does not', () => {
      const ruled = canvas(W, H, (x, y) => (y >= 62 && y < 65 ? [200, 200, 200] : sweep(x, y)))
      expect(heroSurface(ruled, { hero: BELOW, header: HEADER }).joinsHeader).toBe(false)
      // Paylane draws a 1px translucent line at its header's foot, the ribbon running on through it.
      const hairline = canvas(W, H, (x, y) =>
        y === 63 ? mix(sweep(x, y), [120, 140, 170], 0.15) : sweep(x, y)
      )
      expect(heroSurface(hairline, { hero: BELOW, header: HEADER }).joinsHeader).toBe(true)
    })
  })
})

describe('a set-in panel and the light on a coloured hero', () => {
  const PAGE_H = 900
  const BOX: Box = [0, 80, W, 800]
  const PEACH: Fill = [255, 236, 170]
  /** An orange panel set `inset` px into a white page, its corners rounded, lit by `light` where given. */
  function panel(inset: number, light?: (x: number, y: number) => number): Image {
    const [x0, y0, x1, y1] = [inset, 80 + inset, W - inset, 800 - inset]
    const r = inset ? 16 : 0
    return canvas(W, PAGE_H, (x, y) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return WHITE
      const cx = Math.min(Math.max(x, x0 + r), x1 - r)
      const cy = Math.min(Math.max(y, y0 + r), y1 - r)
      if (Math.hypot(x - cx, y - cy) > r) return WHITE
      return light ? mix(ORANGE, PEACH, light(x, y)) : ORANGE
    })
  }
  /** A soft glow of light around a point, fading out over the radii. */
  const glowAt = (gx: number, gy: number, rx: number, ry: number) => (x: number, y: number) =>
    Math.max(0, 1 - Math.hypot((x - gx) / rx, (y - gy) / ry)) ** 1.5

  it('reads an orange panel set into the page, and a glow rising from its foot', () => {
    const img = panel(10, glowAt(W / 2, 790, 360, 200))
    words(img, [276, 296, 1166, 402], WHITE)
    const s = heroSurface(img, { hero: BOX, headline: [276, 296, 1166, 402] })
    expect(s.setIn).toBeGreaterThan(0.005)
    expect(s.setIn).toBeLessThan(0.01)
    expect(s.light?.at).toBe('bottom')
    // The glow's colour is its light core, warmer and paler than the panel.
    expect(deltaE00(PEACH as RGB, hexToRgb(s.light!.colour))).toBeLessThan(12)
  })

  it('reads a glow in a corner, and one along the top', () => {
    const corner = heroSurface(panel(10, glowAt(W - 20, 100, 320, 220)), { hero: BOX })
    expect(corner.light?.at).toBe('corner')
    const top = heroSurface(panel(10, glowAt(W / 2, 100, 360, 180)), { hero: BOX })
    expect(top.light?.at).toBe('top')
  })

  it('reads a full-bleed solid hero as neither set in nor lit', () => {
    const img = canvas(W, PAGE_H, (_x, y) => (y >= 80 && y < 800 ? ORANGE : WHITE))
    words(img, [96, 296, 900, 402], WHITE)
    const s = heroSurface(img, { hero: BOX, headline: [96, 296, 900, 402] })
    expect(s.setIn).toBeNull()
    expect(s.light).toBeNull()
  })

  it('reads no light from a white card or a pop-up on a solid hero, nor from a foot-wide lightening', () => {
    const card = panel(0)
    for (let y = 500; y < 700; y++)
      for (let x = 520; x < 920; x++) card.data.set([...WHITE, 255], (y * W + x) * 4)
    expect(heroSurface(card, { hero: BOX }).light).toBeNull()
    const AMBER: Fill = [252, 160, 90]
    const foot = canvas(W, PAGE_H, (_x, y) =>
      y >= 80 && y < 800 ? mix(ORANGE, AMBER, (y - 656) / 144) : WHITE
    )
    expect(heroSurface(foot, { hero: BOX }).light).toBeNull()
  })

  it('reads a panel lined by a thin rule at the page’s edge as full bleed', () => {
    const img = canvas(W, PAGE_H, (x, y) =>
      y >= 80 && y < 800 ? (x < 2 || x >= W - 2 ? INK : ORANGE) : WHITE
    )
    expect(heroSurface(img, { hero: BOX }).setIn).toBeNull()
  })
})
