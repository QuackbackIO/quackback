/**
 * The hero's photo, read from the customer's own screenshot: where it is,
 * what part of it to keep, and whether it is good enough to show.
 *
 * Where: the hero (and the header above it) in 16px blocks, each either the
 * page's own colour or not; the largest run of blocks off the page's colour
 * below the header is the photo's extent, kept only when it reads as a
 * photograph (many colours, none holding much of it) rather than a product
 * picture or a flat panel. The finder's word ("a photo behind the headline")
 * opens the way; a large picture beside words on a plain page counts too.
 *
 * What part: words beside the photo leave it whole (beside them, or along the
 * bottom under them); words on the photo give way to the largest clean part
 * beside or below them when it is large enough, else the photo is kept whole
 * behind the portal's own words with the site's words softened out of it.
 * The site's other marks on it (a price tag, a seal, a caption) are left out
 * too (extract/photo-marks.ts), or mark the photo when no clear part is left.
 *
 * Good enough: wide enough at CSS scale, sharp (not a loading placeholder)
 * and not grainy. The subject is where the photo's detail gathers, outside
 * the words; the veil over a photo behind words is as light as reading at
 * 4.5:1 allows.
 *
 * Pure: no app imports, so the offline harness can load it.
 */
import type { Box, BoxKind, Behind } from './kinds'
import type { Image } from './png'
import { MARK_PAD, boxMarks, clearPart, typeMarks } from './photo-marks'

export interface HeroPhotoInput {
  /** The screenshot at CSS-pixel width. */
  img: Image
  boxes: Partial<Record<BoxKind, Box | null>>
  /** What the finder saw behind the headline. */
  behind: Behind
}

export type PhotoPlace = 'side' | 'edge' | 'cover'

export interface HeroPhotoPlan {
  /** The photo's extent, CSS px. */
  region: Box
  /** The part kept, CSS px. */
  crop: Box
  /** Where the portal shows it: beside the words, under them, or behind them. */
  place: PhotoPlace
  /** The site's words sit on the photo. */
  wordsOn: boolean
  /** Parts of the crop to soften: the site's own words over the photo, CSS px. */
  soften: Box[]
  /** The site's header sits on the photo. */
  joinsHeader: boolean
  /** The site's own labels, badges or controls sit on the part kept and no clear part is large enough. */
  marked: boolean
  why: string
}

/** Block edge in CSS px. */
const BLOCK = 16
/** A block is the page's when this share of it is the page's colour (words on the page leave most of it so). */
const PAGE_SHARE = 0.6
/** RGB distance within which a pixel is the page's colour. */
const PAGE_NEAR = 24
/** A photograph's colours: none of its 4-bit bins holds this much, and this many bins hold 0.2% or more. */
const PHOTO_TOP_BIN = 0.35
const PHOTO_BINS = 40
/** A photo beside words on a plain page counts from this share of the hero. */
const BESIDE_SHARE = 0.2
/** Narrowest crop shown, CSS px: behind or under the words it spans the band; beside them, a column. */
export const MIN_WIDTH: Record<PhotoPlace, number> = { cover: 600, edge: 600, side: 400 }
/** A clean part beside the words is used from this size, CSS px, and this share of the photo. */
const CLEAN_MIN_HEIGHT = 280
const CLEAN_SHARE = 0.3
/** Room kept between the site's words and a clean part, CSS px. */
const WORDS_PAD = 24
/** A photo behind the words runs at least this far below them, CSS px. */
const COVER_BELOW = 48

const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const clampBox = (b: Box, img: Image): Box => [
  Math.max(0, Math.min(img.width, Math.round(b[0]))),
  Math.max(0, Math.min(img.height, Math.round(b[1]))),
  Math.max(0, Math.min(img.width, Math.round(b[2]))),
  Math.max(0, Math.min(img.height, Math.round(b[3]))),
]

/** The page's colour: the commonest colour just below the hero and beside it, else around the image's edge. */
function pageColour(img: Image, hero: Box): [number, number, number] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number) => {
    const i = (y * img.width + x) * 4
    const r = img.data[i]!
    const g = img.data[i + 1]!
    const b = img.data[i + 2]!
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bin = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
    bin.n++
    bin.r += r
    bin.g += g
    bin.b += b
    bins.set(k, bin)
  }
  const below = Math.min(img.height, hero[3] + 120)
  for (let y = hero[3]; y < below; y += 2) for (let x = 0; x < img.width; x += 4) add(x, y)
  for (let y = hero[1]; y < hero[3]; y += 4) {
    for (let x = 0; x < hero[0]; x += 2) add(x, y)
    for (let x = hero[2]; x < img.width; x += 2) add(x, y)
  }
  if (!bins.size)
    for (let y = 0; y < img.height; y += 4) {
      add(0, y)
      add(img.width - 1, y)
    }
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0]
  return top ? [top.r / top.n, top.g / top.n, top.b / top.n] : [255, 255, 255]
}

/** Whether a region's colours read as a photograph, leaving out the boxes given. */
export function looksLikePhoto(img: Image, region: Box, leaveOut: Box[] = []): boolean {
  const bins = new Map<number, number>()
  let n = 0
  for (let y = region[1]; y < region[3]; y += 2)
    for (let x = region[0]; x < region[2]; x += 2) {
      if (leaveOut.some((b) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3])) continue
      const i = (y * img.width + x) * 4
      const k =
        ((img.data[i]! >> 4) << 8) | ((img.data[i + 1]! >> 4) << 4) | (img.data[i + 2]! >> 4)
      bins.set(k, (bins.get(k) ?? 0) + 1)
      n++
    }
  if (n < 400) return false
  const counts = [...bins.values()].sort((a, b) => b - a)
  const many = counts.filter((c) => c / n >= 0.002).length
  return counts[0]! / n < PHOTO_TOP_BIN && many >= PHOTO_BINS
}

/** The site's words in the hero: the headline, its subtitle and its buttons. */
function wordBoxes(boxes: HeroPhotoInput['boxes']): Box[] {
  return (['headline', 'subtitle', 'primary_button', 'secondary_button'] as const)
    .map((k) => boxes[k])
    .filter((b): b is Box => !!b)
}

const unionOf = (bs: Box[]): Box | null =>
  bs.length
    ? [
        Math.min(...bs.map((b) => b[0])),
        Math.min(...bs.map((b) => b[1])),
        Math.max(...bs.map((b) => b[2])),
        Math.max(...bs.map((b) => b[3])),
      ]
    : null

/**
 * The photo's extent: the largest run of blocks off the page's colour inside
 * the hero below the header, as a box; and whether the header's own blocks
 * above it are off the page's colour too (the header sits on the photo).
 */
function photoExtent(
  img: Image,
  hero: Box,
  header: Box | null
): { region: Box; joinsHeader: boolean } | null {
  const page = pageColour(img, hero)
  const foot = header ? Math.max(hero[1], header[3]) : hero[1]
  const top = header ? Math.min(hero[1], header[1]) : hero[1]
  const x0 = hero[0]
  const cols = Math.floor((hero[2] - x0) / BLOCK)
  const rows = Math.floor((hero[3] - top) / BLOCK)
  if (cols < 4 || rows < 4) return null
  const off = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let near = 0
      let n = 0
      for (let y = top + r * BLOCK; y < top + (r + 1) * BLOCK; y += 2)
        for (let x = x0 + c * BLOCK; x < x0 + (c + 1) * BLOCK; x += 2) {
          const i = (y * img.width + x) * 4
          const d = Math.hypot(
            img.data[i]! - page[0],
            img.data[i + 1]! - page[1],
            img.data[i + 2]! - page[2]
          )
          if (d < PAGE_NEAR) near++
          n++
        }
      off[r * cols + c] = near / n < PAGE_SHARE ? 1 : 0
    }
  // The largest run of off-page blocks below the header's foot.
  const firstRow = Math.ceil((foot - top) / BLOCK)
  const seen = new Uint8Array(cols * rows)
  let best: { n: number; box: [number, number, number, number] } | null = null
  for (let r = firstRow; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const t = r * cols + c
      if (!off[t] || seen[t]) continue
      const stack = [t]
      seen[t] = 1
      let n = 0
      const b: [number, number, number, number] = [c, r, c, r]
      while (stack.length) {
        const u = stack.pop()!
        const ur = Math.floor(u / cols)
        const uc = u % cols
        n++
        b[0] = Math.min(b[0], uc)
        b[1] = Math.min(b[1], ur)
        b[2] = Math.max(b[2], uc)
        b[3] = Math.max(b[3], ur)
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const vr = ur + dr
          const vc = uc + dc
          if (vr < firstRow || vr >= rows || vc < 0 || vc >= cols) continue
          const v = vr * cols + vc
          if (off[v] && !seen[v]) {
            seen[v] = 1
            stack.push(v)
          }
        }
      }
      if (!best || n > best.n) best = { n, box: b }
    }
  if (!best) return null
  const [c0, r0, c1, r1] = best.box
  const region: Box = [
    x0 + c0 * BLOCK,
    top + r0 * BLOCK,
    x0 + (c1 + 1) * BLOCK,
    top + (r1 + 1) * BLOCK,
  ]
  // The header sits on the photo: the photo starts at its foot and the header's blocks above it are off the page too.
  let joinsHeader = false
  if (header && firstRow > 0 && r0 <= firstRow) {
    let above = 0
    let all = 0
    for (let r = Math.floor((header[1] - top) / BLOCK); r < firstRow; r++)
      for (let c = c0; c <= c1; c++) {
        all++
        if (off[r * cols + c]) above++
      }
    joinsHeader = all > 0 && above / all >= 0.7
  }
  return { region, joinsHeader }
}

/** A rounded card's corners are the page's: step the box in until its corners are the photo's. */
function clearCorners(img: Image, box: Box, page: [number, number, number]): Box {
  const pageAt = (x: number, y: number) => {
    const i = (Math.min(img.height - 1, y) * img.width + Math.min(img.width - 1, x)) * 4
    return (
      Math.hypot(img.data[i]! - page[0], img.data[i + 1]! - page[1], img.data[i + 2]! - page[2]) <
      PAGE_NEAR
    )
  }
  let b = box
  for (let step = 0; step < 16; step++) {
    const corners: Array<[number, number]> = [
      [b[0] + 1, b[1] + 1],
      [b[2] - 2, b[1] + 1],
      [b[0] + 1, b[3] - 2],
      [b[2] - 2, b[3] - 2],
    ]
    if (!corners.some(([x, y]) => pageAt(x, y))) break
    b = [b[0] + 4, b[1] + 4, b[2] - 4, b[3] - 4]
  }
  return b
}

/**
 * What to take from a hero photo, or null when the hero is not photo-led
 * (the finder saw no photo and no large photograph sits beside the words).
 */
export function planHeroPhoto(input: HeroPhotoInput): HeroPhotoPlan | null {
  const plan = placePhoto(input)
  return plan && clearOfMarks(plan, input)
}

const grow = (b: Box, by: number): Box => [b[0] - by, b[1] - by, b[2] + by, b[3] + by]

/**
 * The part kept, clear of the site's own marks on the photo (a price tag, a
 * badge, a caption, a carousel's words) and of its words: the largest clear
 * part when one is large enough to show, else marked. Small seals at the
 * photo's edge, off the words, leave the part kept as it was (they sit at the
 * picture's rim, where its subject is not, and cutting them away would cost
 * the photo far more than they take). Behind the words the photo is kept
 * whole: marks below the words trim it above them, and any other mark marks
 * it.
 */
function clearOfMarks(plan: Omit<HeroPhotoPlan, 'marked'>, input: HeroPhotoInput): HeroPhotoPlan {
  const { img, boxes } = input
  const words = wordBoxes(boxes)
  const found = [
    ...typeMarks(
      img,
      plan.region,
      words.map((w) => grow(w, WORDS_PAD))
    ),
    ...boxMarks(plan.region, [
      boxes.card,
      boxes.link,
      boxes.input_field,
      boxes.product_screenshot,
      boxes.section_heading,
    ]),
  ]
  const marks = found.map((m) => grow(m, MARK_PAD))
  const on = (b: Box) => overlap(b, plan.crop) > 0
  if (plan.place === 'cover') {
    // Marks below the words (a row of review badges) trim the photo above them, kept a little below the words.
    const hit = marks.filter(on)
    if (!hit.length) return { ...plan, marked: false }
    const all = unionOf(words)
    const bottom = Math.min(...hit.map((m) => m[1]))
    if (!all || bottom < all[3] + COVER_BELOW) return { ...plan, marked: true }
    return {
      ...plan,
      crop: [plan.crop[0], plan.crop[1], plan.crop[2], bottom],
      soften: plan.soften
        .map((b): Box => [b[0], b[1], b[2], Math.min(b[3], bottom)])
        .filter((b) => b[3] > b[1]),
      marked: false,
    }
  }
  const wordsOn = words.map((w) => grow(w, WORDS_PAD)).filter(on)
  const blocks = [...marks.filter(on), ...wordsOn]
  if (!blocks.length) return { ...plan, marked: false }
  if (!wordsOn.length && edgeSeals(found.filter(on), plan.crop)) return { ...plan, marked: false }
  const part = clearPart(plan.crop, blocks, MIN_WIDTH.side, CLEAN_MIN_HEIGHT)
  if (!part) return { ...plan, marked: true }
  return {
    ...plan,
    crop: part,
    marked: false,
    why: `${plan.why}, clear of the site’s own labels and words`,
  }
}

/**
 * A seal or badge takes at most this share of the part kept (a trust seal or
 * corner badge measures about 1%; a price card or a caption block 5% and
 * more), and all of them together at most this share.
 */
const SEAL_SHARE = 0.025
const SEALS_SHARE = 0.05
/** A seal sits at the edge: within this share of the part's width or height of a side. */
const EDGE_BAND = 0.2

/** The marks are only small seals along the part's rim, each off its middle. */
function edgeSeals(marks: Box[], crop: Box): boolean {
  if (!marks.length) return false
  const whole = area(crop)
  const w = crop[2] - crop[0]
  const h = crop[3] - crop[1]
  const atEdge = (m: Box) =>
    m[0] - crop[0] <= EDGE_BAND * w ||
    crop[2] - m[2] <= EDGE_BAND * w ||
    m[1] - crop[1] <= EDGE_BAND * h ||
    crop[3] - m[3] <= EDGE_BAND * h
  const shares = marks.map((m) => overlap(m, crop) / whole)
  return (
    shares.every((s) => s <= SEAL_SHARE) &&
    shares.reduce((a, b) => a + b, 0) <= SEALS_SHARE &&
    marks.every(atEdge)
  )
}

function placePhoto(input: HeroPhotoInput): Omit<HeroPhotoPlan, 'marked'> | null {
  const { img, boxes } = input
  const hero = boxes.hero ? clampBox(boxes.hero, img) : null
  if (!hero || area(hero) < BLOCK * BLOCK * 16) return null
  const header = boxes.header ? clampBox(boxes.header, img) : null
  const extent = photoExtent(img, hero, header)
  if (!extent) return null
  const page = pageColour(img, hero)
  const region = clearCorners(img, extent.region, page)
  if (region[2] - region[0] < BLOCK * 4 || region[3] - region[1] < BLOCK * 4) return null
  const words = wordBoxes(boxes)
  if (!looksLikePhoto(img, region, words)) return null
  const said = input.behind === 'photo'
  if (!said && area(region) < BESIDE_SHARE * area(hero)) return null

  const all = unionOf(words)
  const wordsOn = !!all && overlap(all, region) >= 0.5 * area(all)
  if (!all || !wordsOn) {
    const under = all && all[3] <= region[1] + 8
    return {
      region,
      crop: region,
      place: under ? 'edge' : 'side',
      wordsOn: false,
      soften: [],
      joinsHeader: extent.joinsHeader,
      why: under ? 'a photo sits under the words' : 'a photo sits beside the words',
    }
  }
  // Words on the photo: the largest clean part beside, below or above them, when it is large
  // enough; centred words are the photo's own composition, kept whole behind them.
  const centred =
    Math.abs((all[0] + all[2]) / 2 - (region[0] + region[2]) / 2) < 0.06 * (region[2] - region[0])
  const pad: Box = [all[0] - WORDS_PAD, all[1] - WORDS_PAD, all[2] + WORDS_PAD, all[3] + WORDS_PAD]
  const parts: Box[] = [
    [Math.max(region[0], pad[2]), region[1], region[2], region[3]],
    [region[0], region[1], Math.min(region[2], pad[0]), region[3]],
    [region[0], Math.max(region[1], pad[3]), region[2], region[3]],
    [region[0], region[1], region[2], Math.min(region[3], pad[1])],
  ]
  const clean = parts
    .filter(() => !centred)
    .filter(
      (p) =>
        p[2] - p[0] >= MIN_WIDTH.side &&
        p[3] - p[1] >= CLEAN_MIN_HEIGHT &&
        area(p) >= CLEAN_SHARE * area(region)
    )
    .sort((a, b) => area(b) - area(a))[0]
  if (clean)
    return {
      region,
      crop: clean,
      place: 'side',
      wordsOn: true,
      soften: [],
      joinsHeader: extent.joinsHeader,
      why: 'the clearest part of the photo behind the words, beside the words',
    }
  // Kept whole behind the portal's words, trimmed below them, the site's words softened.
  const wordsBottom = all[3]
  const bottom = Math.min(
    region[3],
    wordsBottom + Math.max(COVER_BELOW, 0.25 * (wordsBottom - region[1]))
  )
  const crop: Box = [region[0], region[1], region[2], Math.round(bottom)]
  const soften = words
    .map((b): Box => [b[0] - 12, b[1] - 12, b[2] + 12, b[3] + 12])
    .map((b): Box => [
      Math.max(crop[0], b[0]),
      Math.max(crop[1], b[1]),
      Math.min(crop[2], b[2]),
      Math.min(crop[3], b[3]),
    ])
    .filter((b) => b[2] > b[0] && b[3] > b[1])
  return {
    region,
    crop,
    place: 'cover',
    wordsOn: true,
    soften,
    joinsHeader: extent.joinsHeader,
    why: 'a photo fills the hero behind the words',
  }
}
