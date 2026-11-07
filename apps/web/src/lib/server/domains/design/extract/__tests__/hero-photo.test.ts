/**
 * The hero's photo on synthetic heroes with known answers: a photograph is
 * many colours with sharp detail, a product picture or panel a few flat ones.
 * Words beside a photo leave it whole; words on it give way to a clean part
 * beside them, or soften out of a photo kept whole; a header on the photo is
 * read; crops too small, blurred or grainy are refused; the subject and the
 * veil are measured.
 */
import { describe, expect, it } from 'vitest'
import { MIN_WIDTH, planHeroPhoto } from '../hero-photo'
import { cropImage, erase, photoFocus, photoQuality, photoShade, soften } from '../photo-tools'
import type { Box } from '../kinds'
import type { Image } from '../png'

type Fill = [number, number, number]
const W = 1440
const H = 900
const WHITE: Fill = [255, 255, 255]
const INK: Fill = [17, 17, 17]

function canvas(width: number, height: number, bg: (x: number, y: number) => Fill): Image {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([...bg(x, y), 255], (y * width + x) * 4)
  return { width, height, data }
}

/** A seeded random, so the pictures are the same each run. */
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * A photograph: soft light across a scene in many colours, with objects
 * drawn sharp (discs of their own colour) and a little sensor noise.
 */
function photo(seed = 1, { detailAt }: { detailAt?: [number, number] } = {}) {
  const rnd = random(seed)
  const discs = Array.from({ length: 40 }, () => ({
    x: rnd() * W,
    y: rnd() * H,
    r: 10 + rnd() * 50,
    c: [rnd() * 255, rnd() * 255, rnd() * 255] as Fill,
  }))
  // A busy subject: many small sharp discs gathered at one place.
  if (detailAt)
    for (let i = 0; i < 160; i++)
      discs.push({
        x: detailAt[0] + (rnd() - 0.5) * 160,
        y: detailAt[1] + (rnd() - 0.5) * 160,
        r: 3 + rnd() * 6,
        c: [rnd() * 255, rnd() * 255, rnd() * 255] as Fill,
      })
  const noise = random(seed + 7)
  return (x: number, y: number): Fill => {
    for (let i = discs.length - 1; i >= 0; i--) {
      const d = discs[i]!
      if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r * d.r) return d.c
    }
    const n = (noise() - 0.5) * 6
    return [
      90 + 70 * Math.sin(x / 97 + y / 151) + n,
      110 + 60 * Math.sin(x / 131 - y / 83 + 1) + n,
      100 + 80 * Math.cos(x / 173 + y / 59) + n,
    ]
  }
}

/** Lines of words: vertical strokes 3px wide every 9px, as heavy type draws. */
function words(img: Image, [x0, y0, x1, y1]: Box, ink: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if ((x - x0) % 9 < 3 && (y - y0) % 40 < 30)
        img.data.set([...ink, 255], (y * img.width + x) * 4)
}

const inside = (x: number, y: number, b: Box) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3]
const HEADER: Box = [0, 0, W, 80]
const HERO: Box = [0, 80, W, 820]

describe('planHeroPhoto', () => {
  it('finds no photo on a plain page with a product picture of flat panels', () => {
    const pic: Box = [760, 160, 1340, 700]
    const img = canvas(W, H, (x, y) =>
      inside(x, y, pic)
        ? x < 900
          ? [240, 242, 245]
          : y < 260
            ? [30, 30, 40]
            : [255, 255, 255]
        : WHITE
    )
    const headline: Box = [96, 300, 640, 420]
    words(img, headline, INK)
    expect(
      planHeroPhoto({
        img,
        boxes: { hero: HERO, header: HEADER, headline, product_screenshot: pic },
        behind: 'photo',
      })
    ).toBeNull()
  })

  it('keeps a full-bleed photo whole behind centred words, softening them and trimming below', () => {
    const scene = photo(2)
    const img = canvas(W, H, (x, y) => (y >= 80 && y < 820 ? scene(x, y) : WHITE))
    const headline: Box = [420, 200, 1020, 330]
    const button: Box = [600, 380, 840, 430]
    words(img, headline, WHITE)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline, primary_button: button },
      behind: 'photo',
    })
    expect(plan?.place).toBe('cover')
    expect(plan?.wordsOn).toBe(true)
    expect(plan!.crop[0]).toBeLessThanOrEqual(16)
    expect(plan!.crop[2]).toBeGreaterThanOrEqual(W - 16)
    // Trimmed a little below the words, not down to the photo's foot.
    expect(plan!.crop[3]).toBeLessThan(820)
    expect(plan!.crop[3]).toBeGreaterThan(430)
    expect(plan!.soften.length).toBe(2)
    expect(plan!.joinsHeader).toBe(false)
  })

  it('takes a photo beside words on a plain page as it is, beside them', () => {
    const scene = photo(3)
    const pic: Box = [760, 140, 1360, 760]
    const img = canvas(W, H, (x, y) => (inside(x, y, pic) ? scene(x, y) : WHITE))
    const headline: Box = [96, 300, 640, 420]
    words(img, headline, INK)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'plain',
    })
    expect(plan?.place).toBe('side')
    expect(plan?.wordsOn).toBe(false)
    for (const [i, v] of pic.entries()) expect(Math.abs(plan!.crop[i]! - v)).toBeLessThanOrEqual(16)
  })

  it('takes a photo under the words along the bottom', () => {
    const scene = photo(4)
    const pic: Box = [96, 460, 1344, 820]
    const img = canvas(W, H, (x, y) => (inside(x, y, pic) ? scene(x, y) : WHITE))
    const headline: Box = [96, 160, 900, 280]
    words(img, headline, INK)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'photo',
    })
    expect(plan?.place).toBe('edge')
  })

  it('takes the clean part of a rounded photo card beside words set on it', () => {
    const scene = photo(5)
    const card: Box = [24, 88, 1416, 836]
    const radius = 48
    const inCard = (x: number, y: number) => {
      if (!inside(x, y, card)) return false
      const cx = Math.min(Math.max(x, card[0] + radius), card[2] - radius)
      const cy = Math.min(Math.max(y, card[1] + radius), card[3] - radius)
      return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
    }
    const img = canvas(W, H, (x, y) => (inCard(x, y) ? scene(x, y) : WHITE))
    const headline: Box = [100, 380, 720, 490]
    const subtitle: Box = [100, 520, 730, 570]
    const button: Box = [100, 600, 364, 645]
    words(img, headline, WHITE)
    const plan = planHeroPhoto({
      img,
      boxes: {
        hero: [0, 88, W, 836],
        header: [0, 0, W, 87],
        headline,
        subtitle,
        primary_button: button,
      },
      behind: 'photo',
    })
    expect(plan?.place).toBe('side')
    expect(plan?.wordsOn).toBe(true)
    // Right of the words, clear of the card's rounded corners.
    expect(plan!.crop[0]).toBeGreaterThanOrEqual(730 + 24)
    expect(plan!.crop[2]).toBeLessThanOrEqual(1416)
    const corner = (x: number, y: number) => inCard(x, y)
    expect(corner(plan!.crop[2] - 1, plan!.crop[1])).toBe(true)
  })

  it('reads a header that sits on the photo', () => {
    const scene = photo(6)
    const img = canvas(W, H, (x, y) => (y < 760 ? scene(x, y) : WHITE))
    const headline: Box = [420, 260, 1020, 380]
    words(img, headline, WHITE)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: [0, 80, W, 760], header: HEADER, headline },
      behind: 'photo',
    })
    expect(plan?.joinsHeader).toBe(true)
    // The crop starts under the header: the site's own menu is never taken.
    expect(plan!.crop[1]).toBeGreaterThanOrEqual(80)
  })
})

/** A badge laid over a photo: a white plate with a line of small dark type on it. */
function badge(img: Image, [x0, y0, x1, y1]: Box) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const type = y >= y0 + 8 && y < y1 - 8 && x >= x0 + 8 && x < x1 - 8 && (x - x0) % 5 < 2
      img.data.set([...(type ? INK : WHITE), 255], (y * img.width + x) * 4)
    }
}
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

describe('planHeroPhoto, with the site’s own marks on the photo', () => {
  it('keeps the part as it was under small seals at the photo’s edge', () => {
    const scene = photo(11)
    const pic: Box = [720, 140, 1376, 780]
    const img = canvas(W, H, (x, y) => (inside(x, y, pic) ? scene(x, y) : WHITE))
    const headline: Box = [96, 300, 640, 420]
    words(img, headline, INK)
    badge(img, [1220, 170, 1340, 240])
    badge(img, [1240, 690, 1340, 750])
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'photo',
    })
    expect(plan?.place).toBe('side')
    expect(plan?.marked).toBe(false)
    for (const [i, v] of pic.entries()) expect(Math.abs(plan!.crop[i]! - v)).toBeLessThanOrEqual(16)
  })

  it('leaves a label in the middle of the photo out of the part kept', () => {
    const scene = photo(11)
    const pic: Box = [720, 140, 1376, 780]
    const img = canvas(W, H, (x, y) => (inside(x, y, pic) ? scene(x, y) : WHITE))
    const headline: Box = [96, 300, 640, 420]
    words(img, headline, INK)
    const label: Box = [980, 420, 1100, 480]
    badge(img, label)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'photo',
    })
    expect(plan?.marked).toBe(false)
    expect(overlaps(plan!.crop, label)).toBe(false)
    expect(plan!.crop[2] - plan!.crop[0]).toBeGreaterThanOrEqual(MIN_WIDTH.side)
  })

  it('leaves a price card the finder boxed out of the part kept', () => {
    const scene = photo(12)
    const pic: Box = [720, 140, 1376, 780]
    const img = canvas(W, H, (x, y) => (inside(x, y, pic) ? scene(x, y) : WHITE))
    const headline: Box = [96, 300, 640, 420]
    words(img, headline, INK)
    const card: Box = [1200, 300, 1340, 480]
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline, card },
      behind: 'photo',
    })
    expect(plan?.marked).toBe(false)
    expect(overlaps(plan!.crop, card)).toBe(false)
  })

  it('marks a photo whose labels leave no clear part large enough to show', () => {
    const scene = photo(13)
    const pic: Box = [760, 160, 1340, 600]
    const img = canvas(W, H, (x, y) => (inside(x, y, pic) ? scene(x, y) : WHITE))
    const headline: Box = [96, 300, 640, 420]
    words(img, headline, INK)
    for (const b of [
      [1000, 180, 1100, 230],
      [790, 360, 900, 400],
      [1180, 380, 1320, 420],
      [980, 540, 1100, 580],
    ] as Box[])
      badge(img, b)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'photo',
    })
    expect(plan?.marked).toBe(true)
  })

  it('keeps a photo with none of the site’s marks as it is', () => {
    const scene = photo(3)
    const pic: Box = [760, 140, 1360, 760]
    const img = canvas(W, H, (x, y) => (inside(x, y, pic) ? scene(x, y) : WHITE))
    const headline: Box = [96, 300, 640, 420]
    words(img, headline, INK)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'plain',
    })
    expect(plan?.marked).toBe(false)
    for (const [i, v] of pic.entries()) expect(Math.abs(plan!.crop[i]! - v)).toBeLessThanOrEqual(16)
  })

  it('trims a photo behind the words above a row of badges below them', () => {
    const scene = photo(2)
    const img = canvas(W, H, (x, y) => (y >= 80 && y < 820 ? scene(x, y) : WHITE))
    const headline: Box = [420, 160, 1020, 260]
    words(img, headline, WHITE)
    const reviews: Box = [560, 520, 880, 570]
    badge(img, reviews)
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'photo',
    })
    expect(plan?.place).toBe('cover')
    expect(plan?.marked).toBe(false)
    expect(plan!.crop[3]).toBeLessThanOrEqual(reviews[1])
    expect(plan!.crop[3]).toBeGreaterThanOrEqual(headline[3] + 48)
  })

  it('marks a photo behind the words with a seal beside them', () => {
    const scene = photo(2)
    const img = canvas(W, H, (x, y) => (y >= 80 && y < 820 ? scene(x, y) : WHITE))
    const headline: Box = [420, 200, 1020, 330]
    words(img, headline, WHITE)
    badge(img, [1200, 220, 1320, 280])
    const plan = planHeroPhoto({
      img,
      boxes: { hero: HERO, header: HEADER, headline },
      behind: 'photo',
    })
    expect(plan?.place).toBe('cover')
    expect(plan?.marked).toBe(true)
  })
})

describe('photoQuality', () => {
  const sharp = canvas(800, 400, photo(7))
  it('passes a sharp photo large enough for its place', () => {
    expect(photoQuality(sharp, 'cover').ok).toBe(true)
  })
  it('refuses a crop narrower than its place needs', () => {
    const narrow = cropImage(sharp, [0, 0, MIN_WIDTH.cover - 40, 400])
    expect(photoQuality(narrow, 'cover')).toMatchObject({ ok: false })
    expect(photoQuality(narrow, 'side').ok).toBe(true)
  })
  it('refuses a blurred placeholder', () => {
    const blurred = cropImage(sharp, [0, 0, 800, 400])
    soften(blurred, [0, 0, 800, 400], 10)
    expect(photoQuality(blurred, 'cover')).toMatchObject({ ok: false })
    expect(photoQuality(blurred, 'cover').why).toMatch(/blurred/)
  })
  it('refuses a grainy photo', () => {
    const rnd = random(9)
    const base = photo(7)
    const grainy = canvas(800, 400, (x, y) => base(x, y).map((v) => v + (rnd() - 0.5) * 60) as Fill)
    expect(photoQuality(grainy, 'cover').why).toMatch(/grainy/)
  })
})

describe('photoFocus', () => {
  it('finds the subject where the detail gathers, leaving softened words out', () => {
    const img = canvas(W, 600, photo(10, { detailAt: [1150, 300] }))
    const f = photoFocus(img)
    expect(f.x).toBeGreaterThan(66)
    expect(Math.abs(f.y - 50)).toBeLessThan(20)
  })
})

describe('photoShade', () => {
  it('veils a bright photo more than a dark one, and the words read on what is left', () => {
    const bright = canvas(400, 200, (x, y) => [200 + (x % 50), 210 + (y % 40), 190])
    const dark = canvas(400, 200, (x, y) => [40 + (x % 30), 40 + (y % 20), 50])
    const b = photoShade(bright)
    const d = photoShade(dark)
    expect(d.tone).toBe('dark')
    expect(d.strength).toBeLessThan(b.strength === 0 ? 1 : 100)
    if (b.tone === 'dark') expect(b.strength).toBeGreaterThan(d.strength)
    // White on the darkest veil kept, or near-black on a light one, reads at 4.5:1.
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const l = c.map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
      return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!
    }
    expect(1.05 / (lum(d.under) + 0.05)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('erase', () => {
  it('takes white words out of a photo, leaving its colours', () => {
    const img = canvas(800, 400, photo(11))
    const box: Box = [200, 150, 600, 250]
    words(img, box, WHITE)
    erase(img, box)
    let white = 0
    for (let y = box[1]; y < box[3]; y += 2)
      for (let x = box[0]; x < box[2]; x += 2) {
        const i = (y * img.width + x) * 4
        if (img.data[i]! > 245 && img.data[i + 1]! > 245 && img.data[i + 2]! > 245) white++
      }
    expect(white).toBe(0)
  })
})
