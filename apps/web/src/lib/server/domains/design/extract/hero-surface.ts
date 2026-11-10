/**
 * The hero's surface, measured for the hero rules: how much of it is bold
 * colour (saturated, or deep and coloured), in which colour, and a vivid
 * gradient sweep: how much of the hero it covers, whether the words sit on it
 * or beside it, and its form (a fill under the words, a long diagonal ribbon
 * beside them, or a soft patch of colour beside them). A product picture in
 * the hero is the product's, never the hero's colour.
 *
 * Two reads of a coloured hero's frame and light: whether it is a panel set
 * into the page (the page's colour down both sides, the same width on each)
 * rather than full bleed, and on a hero of one colour, a soft glow of lighter
 * colour in it (rising from its foot, along its top, or in a corner).
 *
 * Two more reads for heroes whose colour is not a fill or a sweep: on a dark
 * hero, a glow (coloured light on the near-black: a radial glow, lit clouds,
 * light beams), and on any hero, a large graphic in one saturated colour (a
 * logo drawn huge, a shape), which a monochrome brand's hero can carry.
 *
 * Pure: no app imports, so the offline harness can load it.
 */
import { hex, oklab } from './color'
import { chromaOf, labDist } from './colours'
import type { Box, BoxKind } from './kinds'
import type { Image } from './png'
import { DARK_PAGE, unitOf } from './roles-evidence'
import { mergeColours, surfaceMap, sweepOf, VIVID, TILE_KINDS } from './surfaces'

export interface HeroGradient {
  /** Share of the hero (outside product pictures) in vivid drift. */
  share: number
  /** The words on it, or beside it on the page. */
  place: 'fill' | 'side'
  /** Under the words a line; beside them a long diagonal ribbon or a soft patch. */
  form: 'linear' | 'ribbon' | 'mesh'
  /** The sweep's long axis, degrees from across (y down); its length over its width. */
  angle: number
  elongation: number
}

/** A colour read over part of the hero: its share of the hero and the colour. */
export interface HeroPatch {
  share: number
  colour: string
  rgb: [number, number, number]
}

export interface HeroSurface {
  /** Share of the hero in bold colour: saturated, or deep and coloured. */
  vivid: number
  /** The largest bold colour, as hex and RGB. */
  vividColour: string | null
  vividRgb: [number, number, number] | null
  gradient: HeroGradient | null
  /** On a dark hero, the coloured light on it, and the hero's own dark; null on a light or flat hero. */
  glow?: (HeroPatch & { base: string }) | null
  /** Bold colour that is mostly one saturated colour, outside product pictures. */
  graphic?: HeroPatch | null
  /**
   * The largest flat dark colour in the hero (a dark section beside or
   * around a picture), however the hero reads as a whole: a photo hero set
   * on a dark panel keeps that panel's colour. Null when under PATCH_SEEN.
   */
  darkSection?: HeroPatch | null
  /**
   * The hero is a panel set into the page: its margin on each side, as a
   * share of the width. Null when it runs to the page's edges.
   */
  setIn?: number | null
  /** On a hero mostly of one colour, a soft glow of lighter colour in it: its share, light core and centre. */
  light?: (HeroPatch & { at: 'bottom' | 'top' | 'corner' }) | null
  /**
   * The header sits on the hero's surface: the colours just above and just
   * below its foot match across the width with no rule between, and the
   * hero's colour reaches it. Null without a header box.
   */
  joinsHeader?: boolean | null
  /**
   * The hero's tone, photo and all, clear of product pictures, buttons and
   * the words: its mean lightness (OKLab), and the main colour of its darker
   * half, which a band drawn for a photo the portal cannot borrow takes.
   */
  tone?: { lightness: number; dark: string } | null
}

const PHOTO = TILE_KINDS.indexOf('photo')
const NONE: HeroSurface = {
  vivid: 0,
  vividColour: null,
  vividRgb: null,
  gradient: null,
  glow: null,
  graphic: null,
  darkSection: null,
  setIn: null,
  light: null,
  joinsHeader: null,
  tone: null,
}

/** A vivid sweep this large is reported (the rules decide what counts). */
const SWEEP_SEEN = 0.03

/**
 * A sweep this much longer than wide, running diagonally, is a ribbon: a payments
 * site's measures 1.5 to 1.9 (clipped by the page's edge), a soft glow about 1.
 */
const RIBBON = 1.4

/** Under the words when half the tiles behind the headline are vivid. */
const UNDER = 0.5

/**
 * A tile is lit on a dark hero when it is this far from the hero's own
 * colour and this much more colourful than it: a deep navy page is its own
 * colour, not a glow.
 */
const LIT_APART = 0.04
const LIT_CHROMA = 0.035
const LIT_OVER = 0.025
/** A glow or a graphic this large is reported (the rules decide what counts). */
const PATCH_SEEN = 0.03
/** A graphic is one colour when its main colour holds this much of the bold area, and saturated from this chroma. */
const ONE_COLOUR = 0.7
const SATURATED = 0.12
/** A flat tile this dark (OKLab) is a dark section's: near black, charcoal, deep navy. */
const SECTION_DARK = 0.25
const FLAT = TILE_KINDS.indexOf('flat')
const GRADIENT = TILE_KINDS.indexOf('gradient')

const patchOf = (
  items: { lab: number[]; rgb: number[]; w: number }[],
  share: number
): HeroPatch | null => {
  const top = mergeColours(items, 0.08)[0]
  if (!top || share < PATCH_SEEN) return null
  const rgb = top.rgb.map(Math.round) as [number, number, number]
  return { share, colour: hex(rgb), rgb }
}

export function heroSurface(
  img: Image,
  boxes: Partial<Record<BoxKind, Box | null>>,
  /** Tile edge in pixels: 8 at CSS scale. */
  size = Math.max(4, Math.round(8 * unitOf(img)))
): HeroSurface {
  const box = boxes.hero
  if (!box || box[2] - box[0] < size * 4 || box[3] - box[1] < size * 4) return NONE
  const joinsHeader = boxes.header ? headerJoins(img, boxes.header, size) : null
  const map = surfaceMap(img, box, size)
  const sweep = sweepOf(map)
  const { cols, rows, lab, rgb } = map
  const [bx, by] = map.box
  const inside = (b: Box | null | undefined, t: number) => {
    if (!b) return false
    const x = bx + ((t % cols) + 0.5) * size
    const y = by + (Math.floor(t / cols) + 0.5) * size
    return x >= b[0] && x < b[2] && y >= b[1] && y < b[3]
  }
  const chroma = (t: number) => Math.hypot(lab[t * 3 + 1]!, lab[t * 3 + 2]!)
  const labOf = (t: number) => [lab[t * 3]!, lab[t * 3 + 1]!, lab[t * 3 + 2]!]
  const rgbOf = (t: number) => [rgb[t * 3]!, rgb[t * 3 + 1]!, rgb[t * 3 + 2]!]
  const outside = (t: number) =>
    !inside(boxes.product_screenshot, t) &&
    !inside(boxes.primary_button, t) &&
    !inside(boxes.secondary_button, t)
  const bold = (t: number) =>
    map.kind[t] !== PHOTO && (chroma(t) >= VIVID || (lab[t * 3]! < 0.6 && chroma(t) >= 0.05))

  let n = 0
  let boldN = 0
  let sweepN = 0
  const items: { lab: number[]; rgb: number[]; w: number }[] = []
  const pts: Array<[number, number]> = []
  let under = 0
  let words = 0
  for (let t = 0; t < cols * rows; t++) {
    if (inside(boxes.product_screenshot, t)) continue
    n++
    if (bold(t)) {
      boldN++
      items.push({
        lab: [lab[t * 3]!, lab[t * 3 + 1]!, lab[t * 3 + 2]!],
        rgb: [rgb[t * 3]!, rgb[t * 3 + 1]!, rgb[t * 3 + 2]!],
        w: 1,
      })
    }
    if (sweep.tile[t] === 2) {
      sweepN++
      pts.push([t % cols, Math.floor(t / cols)])
    }
    if (inside(boxes.headline, t)) {
      words++
      if (sweep.tile[t] === 2 || (map.kind[t] !== PHOTO && chroma(t) >= VIVID)) under++
    }
  }
  if (!n) return NONE
  const top = mergeColours(items, 0.05)[0]
  const glow = glowOf()
  const graphic = graphicOf()
  const darkSection = darkSectionOf()
  const setIn = setInOf(img, box)
  const light = lightOf()
  const tone = toneOf()
  const vividRgb = top
    ? ([Math.round(top.rgb[0]), Math.round(top.rgb[1]), Math.round(top.rgb[2])] as [
        number,
        number,
        number,
      ])
    : null
  const share = sweepN / n
  let gradient: HeroGradient | null = null
  if (share >= SWEEP_SEEN) {
    const { angle, elongation } = axis(pts)
    const place = words && under / words >= UNDER ? 'fill' : 'side'
    const diagonal = Math.abs(angle) >= 20 && Math.abs(angle) <= 80
    gradient = {
      share,
      place,
      form: place === 'fill' ? 'linear' : elongation >= RIBBON && diagonal ? 'ribbon' : 'mesh',
      angle,
      elongation,
    }
  }
  return {
    vivid: boldN / n,
    vividColour: vividRgb ? hex(vividRgb) : null,
    vividRgb,
    gradient,
    glow,
    graphic,
    darkSection,
    setIn,
    light,
    joinsHeader,
    tone,
  }

  /** The hero's mean lightness and the main colour of its darker half, outside pictures, buttons and words. */
  function toneOf(): HeroSurface['tone'] {
    const tiles: { lab: number[]; rgb: number[]; w: number }[] = []
    for (let t = 0; t < cols * rows; t++)
      if (outside(t) && !inside(boxes.headline, t) && !inside(boxes.subtitle, t))
        tiles.push({ lab: labOf(t), rgb: rgbOf(t), w: 1 })
    if (!tiles.length) return null
    const lightness = tiles.reduce((s, x) => s + x.lab[0]!, 0) / tiles.length
    const darker = [...tiles].sort((a, b) => a.lab[0]! - b.lab[0]!)
    const main = mergeColours(darker.slice(0, Math.ceil(darker.length / 2)), 0.08)[0]!
    return { lightness, dark: hex(main.rgb.map(Math.round) as [number, number, number]) }
  }

  /**
   * A soft glow of lighter colour on a hero mostly of one colour: smooth
   * tiles well lighter than the hero's own colour, clear of the words,
   * buttons, fields and pictures and of a set-in panel's margins, gathered
   * round one place. A white card or pop-up is flat, not a glow; a
   * lightening along a whole edge is spread wide, not gathered.
   */
  function lightOf(): (HeroPatch & { at: 'bottom' | 'top' | 'corner' }) | null {
    const clear = (t: number) =>
      outside(t) &&
      map.kind[t] !== PHOTO &&
      !(['headline', 'subtitle', 'input_field', 'card'] as const).some((k) => inside(boxes[k], t))
    const margin = (setIn ?? 0) * img.width + size
    const all: { lab: number[]; rgb: number[]; w: number }[] = []
    const tiles: number[] = []
    for (let t = 0; t < cols * rows; t++) {
      const x = bx + ((t % cols) + 0.5) * size
      if (!clear(t) || (setIn && (x < margin || x > img.width - margin))) continue
      tiles.push(t)
      all.push({ lab: labOf(t), rgb: rgbOf(t), w: 1 })
    }
    const base = mergeColours(all, 0.04)[0]
    if (!base || base.w < ONE_HUE * all.length) return null
    const lit: { lab: number[]; rgb: number[]; w: number }[] = []
    let sx = 0
    let sy = 0
    const at: Array<[number, number]> = []
    tiles.forEach((t, i) => {
      const it = all[i]!
      if (map.kind[t] !== GRADIENT) return
      if (it.lab[0]! < base.lab[0]! + LIGHTER || labDist(it.lab, base.lab) < LIGHT_APART) return
      const x = ((t % cols) + 0.5) / cols
      const y = (Math.floor(t / cols) + 0.5) / rows
      lit.push(it)
      at.push([x, y])
      sx += x
      sy += y
    })
    const share = lit.length / all.length
    if (share < LIGHT_SEEN) return null
    const [mx, my] = [sx / lit.length, sy / lit.length]
    const spread = (k: 0 | 1, m: number) =>
      Math.sqrt(at.reduce((s, p) => s + (p[k] - m) ** 2, 0) / at.length)
    if (spread(0, mx) > GATHERED || spread(1, my) > GATHERED) return null
    const centred = Math.abs(mx - 0.5) < 0.2
    const place = !centred ? 'corner' : my >= 0.6 ? 'bottom' : my <= 0.4 ? 'top' : null
    if (!place) return null
    // The glow's colour is its core: the lightest quarter of it.
    const core = [...lit].sort((a, b) => b.lab[0]! - a.lab[0]!)
    const top = mergeColours(core.slice(0, Math.max(1, Math.ceil(core.length / 4))), 0.08)[0]!
    const rgb = top.rgb.map(Math.round) as [number, number, number]
    return { share, colour: hex(rgb), rgb, at: place }
  }

  /** The largest flat dark colour, outside product pictures and buttons, as a share of the hero. */
  function darkSectionOf(): HeroPatch | null {
    const dark: { lab: number[]; rgb: number[]; w: number }[] = []
    let all = 0
    for (let t = 0; t < cols * rows; t++) {
      if (!outside(t)) continue
      all++
      if (map.kind[t] === FLAT && lab[t * 3]! < SECTION_DARK)
        dark.push({ lab: labOf(t), rgb: rgbOf(t), w: 1 })
    }
    const main = mergeColours(dark, 0.04)[0]
    if (!main) return null
    return patchOf(
      dark.filter((x) => labDist(x.lab, main.lab) < 0.04),
      main.w / Math.max(1, all)
    )
  }

  /**
   * Soft light inside a box the finder called a product picture: a product's
   * interface is flat colour and type, light glowing behind or around it is
   * smooth. Whether the finder's product box takes the glow in (a panel the
   * glow is drawn on) or not (only the card in it), the glow is read.
   */
  function softInProduct(t: number): boolean {
    return (
      map.kind[t] === GRADIENT &&
      inside(boxes.product_screenshot, t) &&
      !inside(boxes.primary_button, t) &&
      !inside(boxes.secondary_button, t)
    )
  }

  /** The coloured light on a dark hero: tiles well off its own colour and more colourful. */
  function glowOf(): (HeroPatch & { base: string }) | null {
    const all: { lab: number[]; rgb: number[]; w: number }[] = []
    for (let t = 0; t < cols * rows; t++)
      if (map.kind[t] !== PHOTO && (outside(t) || softInProduct(t)))
        all.push({ lab: labOf(t), rgb: rgbOf(t), w: 1 })
    const base = mergeColours(all, 0.04)[0]
    if (!base || base.lab[0]! >= DARK_PAGE) return null
    const over = chromaOf(base.lab) + LIT_OVER
    const lit = all.filter(
      (x) => labDist(x.lab, base.lab) >= LIT_APART && chromaOf(x.lab) >= Math.max(LIT_CHROMA, over)
    )
    // The glow's colour is its core: the most colourful quarter of it.
    const core = [...lit].sort((a, b) => chromaOf(b.lab) - chromaOf(a.lab))
    const patch = patchOf(
      core.slice(0, Math.max(1, Math.ceil(core.length / 4))),
      lit.length / all.length
    )
    return patch && { ...patch, base: hex(base.rgb.map(Math.round) as [number, number, number]) }
  }

  /** Bold colour outside product pictures and buttons, when one saturated colour holds most of it. */
  function graphicOf(): HeroPatch | null {
    const boldTiles: { lab: number[]; rgb: number[]; w: number }[] = []
    let all = 0
    for (let t = 0; t < cols * rows; t++) {
      if (!outside(t)) continue
      all++
      if (bold(t)) boldTiles.push({ lab: labOf(t), rgb: rgbOf(t), w: 1 })
    }
    const main = mergeColours(boldTiles, 0.06)[0]
    if (!main || main.w < ONE_COLOUR * boldTiles.length || chromaOf(main.lab) < SATURATED)
      return null
    return patchOf(
      boldTiles.filter((x) => labDist(x.lab, main.lab) < 0.06),
      main.w / Math.max(1, all)
    )
  }
}

/** A hero is of one colour, for a glow in it, when its main colour holds this much of it. */
const ONE_HUE = 0.6
/** A glow's tiles are this much lighter (OKLab) than the hero's colour, and this far from it. */
const LIGHTER = 0.08
const LIGHT_APART = 0.1
/**
 * A glow this large, and gathered this closely round its centre (the spread
 * of its tiles, as a share of the hero), is read: a synthetic glow rising
 * from an orange panel's foot covers 0.02 to 0.05 spread 0.07 across, a
 * lightening along a whole edge spreads 0.29.
 */
const LIGHT_SEEN = 0.01
const GATHERED = 0.2

/**
 * The page's colour runs down both sides of the hero this far in, the same
 * on each, before the hero's colour starts: a panel set into the page. A
 * panel set in further is in the finder's hero box; a rule two pixels wide
 * is an edge, not a margin.
 */
const SET_IN_LEAST = 0.003
const SET_IN_MOST = 0.06
/** Rows whose margin matches the median within this many pixels agree; this share of rows must. */
const SET_IN_SLACK = 2
const SET_IN_AGREE = 0.9
/** A step this far (OKLab) from the colour at the page's edge starts the panel. */
const STEP = 0.08

/**
 * How far a panel hero is set into the page, as a share of the width: along
 * the middle half of the hero's rows, the colour at the page's edge holds
 * this far in from each side, then steps to another that holds past the
 * step (not a line of type). Null when no such margin is read.
 */
function setInOf(img: Image, box: Box): number | null {
  const W = img.width
  const most = Math.round(SET_IN_MOST * W)
  const at = (x: number, y: number) => {
    const i = (y * W + x) * 4
    return oklab([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
  }
  const marginAt = (y: number, side: 1 | -1): number | null => {
    const x0 = side === 1 ? 0 : W - 1
    const edge = at(x0, y)
    for (let d = 1; d < most; d++) {
      if (labDist(at(x0 + side * d, y), edge) <= STEP) continue
      // The panel's colour holds past the step: a stroke of type or a rule does not.
      const run = Math.max(4, Math.round(0.01 * W))
      for (let k = 1; k <= run; k++)
        if (labDist(at(x0 + side * (d + k), y), edge) <= STEP) return null
      return d
    }
    return null
  }
  const y0 = Math.round(box[1] + 0.25 * (box[3] - box[1]))
  const y1 = Math.round(box[1] + 0.75 * (box[3] - box[1]))
  const step = Math.max(1, Math.round((y1 - y0) / 60))
  const sides: Array<Array<number | null>> = [[], []]
  for (let y = y0; y < y1; y += step) {
    sides[0]!.push(marginAt(y, 1))
    sides[1]!.push(marginAt(y, -1))
  }
  const medians = sides.map((ms) => {
    const got = ms.filter((m): m is number => m !== null).sort((a, b) => a - b)
    const m = got[Math.floor(got.length / 2)]
    if (m === undefined) return null
    const agree = ms.filter((v) => v !== null && Math.abs(v - m) <= SET_IN_SLACK).length
    return agree >= SET_IN_AGREE * ms.length ? m : null
  })
  const [left, right] = medians
  if (left == null || right == null) return null
  if (Math.abs(left - right) > Math.max(SET_IN_SLACK + 1, 0.25 * Math.max(left, right))) return null
  const margin = (left + right) / 2 / W
  return margin >= SET_IN_LEAST ? margin : null
}

/** Columns this alike above and below the header's foot are one surface. */
const SAME = 0.04
/** A row this far off both sides of the foot, across half the width, is part of a rule. */
const RULE = 0.03
/** A paper colour (near white, unsaturated) does not carry the hero to the header. */
const isPaper = (lab: readonly number[]) => lab[0]! > 0.9 && chromaOf(lab) < 0.02

/**
 * Whether the header shares the hero's surface: at its foot, the strip just
 * above (clear of its text) and the strip just below match column by column,
 * no rule (two rows or more; a hairline is the header's own edge) parts them, and the strip below carries colour (not only the
 * paper) somewhere across the width: a gradient running up behind the
 * header, or a header in the hero's solid colour.
 */
function headerJoins(img: Image, header: Box, size: number): boolean {
  const W = img.width
  const foot = Math.round(header[3])
  const band = Math.max(2, Math.round(size / 2))
  if (foot - band - 2 < 0 || foot + band + 2 > img.height) return false
  const lab = (x0: number, y0: number, y1: number) => {
    const acc = [0, 0, 0]
    let n = 0
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < Math.min(W, x0 + size); x++) {
        const i = (y * W + x) * 4
        const c = oklab([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!])
        acc[0] += c[0]
        acc[1] += c[1]
        acc[2] += c[2]
        n++
      }
    return acc.map((v) => v / Math.max(1, n))
  }
  let same = 0
  let coloured = 0
  let cols = 0
  const ruleRows = new Map<number, number>()
  for (let x = 0; x + size <= W; x += size) {
    cols++
    const above = lab(x, foot - band - 2, foot - 2)
    const below = lab(x, foot + 2, foot + band + 2)
    if (labDist(above, below) < SAME) same++
    if (!isPaper(below)) coloured++
    for (let y = foot - 2; y < foot + 2; y++) {
      const row = lab(x, y, y + 1)
      if (labDist(row, above) > RULE && labDist(row, below) > RULE)
        ruleRows.set(y, (ruleRows.get(y) ?? 0) + 1)
    }
  }
  if (!cols) return false
  // A hairline is the header's own edge (the portal draws none on a band); a rule is two rows or more.
  const rule = [...ruleRows.values()].filter((n) => n >= cols / 2).length >= 2
  return !rule && same >= 0.9 * cols && coloured >= 0.15 * cols
}

/** The points' long axis (degrees from across, y down) and its length over its width. */
function axis(pts: Array<[number, number]>): { angle: number; elongation: number } {
  const n = pts.length
  if (n < 3) return { angle: 0, elongation: 1 }
  let mx = 0
  let my = 0
  for (const [x, y] of pts) {
    mx += x
    my += y
  }
  mx /= n
  my /= n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  const tr = (sxx + syy) / n
  const det = (sxx * syy - sxy * sxy) / (n * n)
  const gap = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + gap
  const l2 = Math.max(1e-9, tr / 2 - gap)
  const angle = (Math.atan2(2 * sxy, sxx - syy) / 2) * (180 / Math.PI)
  return { angle, elongation: Math.sqrt(l1 / l2) }
}
