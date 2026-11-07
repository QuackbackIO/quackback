/**
 * The logo as a transparent image, cut from a screenshot inside the element
 * finder's snapped logo box.
 *
 * - Ink: pixels unlike the header colour (the dominant colour of the search
 *   region's frame), with soft alpha from their OKLab distance to it, so
 *   anti-aliased edges fade instead of keeping a halo.
 * - The mark: connected ink components, grouped by proximity; groups mostly
 *   inside the box are the mark, groups mostly outside it (menu words the box
 *   runs into) are left out, and a mark the box clips is followed outside it.
 * - Background: flood fill from the region's edges; enclosed background
 *   (letter counters) is opened too, unless it is a large inner face of a
 *   symbol, which stays opaque.
 * - The cutout is padded, encoded as PNG, and described: its bounds in the
 *   source, its own colours, whether it reads on light and on dark, and its
 *   geometry (aspect, a leading symbol before a name) for the logo's kind.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { okDist, type RGB } from './color'
import type { Box } from './kinds'
import {
  flatFrame,
  geometryOf,
  paletteOf,
  reads,
  type LogoColour,
  type LogoGeometry,
} from './logo-measure'
import { encodePng, type Image } from './png'
import { scaleOf } from './snap'
import { alongLine } from './logo-line'
import { LO, photoInk } from './logo-photo'
import { dropChrome, unGrain, type Comp } from './logo-chrome'
import { FINEST_STROKE, MAX_SHARP, SHARP_PX, sharpened, strokeWidth } from './logo-sharp'

export type { LogoColour, LogoGeometry } from './logo-measure'

export interface LogoCut {
  /** The cutout, padded, RGBA with a transparent background. */
  image: Image
  /** The cutout as PNG, drawn `pngScale` times larger with crisp edges where it is flat and not too fine. */
  png: Uint8Array
  pngScale: number
  /** Tight bounds of the mark in the source image. */
  bounds: Box
  /** Where the cutout's top left sits in the source image (bounds less the padding). */
  origin: [number, number]
  /** The removed background colour (the header behind the logo). */
  background: RGB
  /** The ink's colours, most used first. */
  palette: LogoColour[]
  /** Colours along the mark's outline (where it meets transparency): what must stand out for it to read. */
  outline: LogoColour[]
  readsOnLight: boolean
  readsOnDark: boolean
  /** The background was flat and is removed; false on a photo or gradient (the box is kept). */
  clean: boolean
  /** Ink components in the mark. */
  components: number
  geometry: LogoGeometry
}

export interface CutOptions {
  /** Device scale of the image; found from its width when left out. */
  scale?: number
}

/** OKLab distance from the background where ink starts and where it is solid. */
const HI = 0.11
const LIGHT: RGB = [255, 255, 255]
const DARK: RGB = [18, 18, 18]

const clampBox = (b: readonly number[], img: Image): Box => [
  Math.max(0, Math.round(b[0]!)),
  Math.max(0, Math.round(b[1]!)),
  Math.min(img.width, Math.round(b[2]!)),
  Math.min(img.height, Math.round(b[3]!)),
]

/** Tiny components outside the box from which the background is grain. */
const GRAINY_SPECKS = 40
/** Beside the logo box, a strip this much off the header colour is a photo, not letters. */
const BUSY_SIDE = 0.8

/** The logo cut from `img` inside `box`, or null when the box is empty. */
export function cutLogo(img: Image, box: Box | null, opts: CutOptions = {}): LogoCut | null {
  if (!box) return null
  const s = opts.scale ?? scaleOf(img)
  const b = clampBox(box, img)
  const bw = b[2] - b[0]
  const bh = b[3] - b[1]
  if (bw < 3 || bh < 3) return null
  // A mark running off the region is followed with a wider one, while the background stays flat.
  let last: LogoCut | null = null
  for (let grow = 1; grow <= 16; grow *= 2) {
    const mx = Math.round(Math.max(6 * s, 0.5 * bh) * grow)
    const my = Math.round(Math.max(3 * s, 0.3 * bh) * grow)
    const R = clampBox([b[0] - mx, b[1] - my, b[2] + mx, b[3] + my], img)
    let out = cutIn(img, b, R, s, false)
    // A header colour flat around the box but not beyond it is a photo's calm patch.
    if (out.busy) {
      const photo = cutIn(img, b, R, s, true)
      if (photo.cut.clean) out = photo
    }
    if (last && !out.cut.clean) return last
    if (!out.touches) return out.cut
    last = out.cut
  }
  return last
}

function cutIn(
  img: Image,
  b: Box,
  R: Box,
  s: number,
  overPhoto: boolean
): { cut: LogoCut; touches: boolean; busy: boolean } {
  const W = R[2] - R[0]
  const H = R[3] - R[1]
  // The header colour: the frame just around the snapped box (a wider frame can reach a band or a photo).
  const m = Math.round(Math.max(2 * s, 0.15 * (b[3] - b[1])))
  const ring = clampBox([b[0] - m, b[1] - m, b[2] + m, b[3] + m], img)
  const { colour: bg, share } = flatFrame(img, ring)
  const flat = share >= 0.5 && !overPhoto
  // On a photo, a logo of one ink unlike anything around it is still cut out from it.
  const photo = flat
    ? null
    : photoInk(img, b, [
        ring,
        clampBox([ring[0] - 2, ring[1] - 2, ring[2] + 2, ring[3] + 2], img),
        R,
      ])
  const clean = flat || photo !== null
  const at = (x: number, y: number): RGB => {
    const o = ((R[1] + y) * img.width + R[0] + x) * 4
    return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
  }
  // Soft ink coverage per pixel.
  const a0 = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!clean) {
        a0[y * W + x] = 1
        continue
      }
      if (photo) {
        a0[y * W + x] = photo.alpha(at(x, y))
        continue
      }
      const d = okDist(at(x, y), bg)
      a0[y * W + x] = d <= LO ? 0 : d >= HI ? 1 : (d - LO) / (HI - LO)
    }
  const ink = (i: number) => a0[i]! >= 0.5

  // Connected ink components (8-neighbour).
  const label = new Int32Array(W * H)
  const comps: Comp[] = []
  const stack: number[] = []
  labelInk()
  function labelInk() {
    label.fill(-1)
    comps.length = 0
    for (let i = 0; i < W * H; i++) {
      if (!ink(i) || label[i]! >= 0) continue
      const id = comps.length
      const c: Comp = { box: [W, H, -1, -1], area: 0, inside: 0, sum: [0, 0, 0] }
      label[i] = id
      stack.push(i)
      while (stack.length) {
        const j = stack.pop()!
        const x = j % W
        const y = (j - x) / W
        c.area++
        const px = at(x, y)
        c.sum[0] += px[0]
        c.sum[1] += px[1]
        c.sum[2] += px[2]
        if (R[0] + x >= b[0] && R[0] + x < b[2] && R[1] + y >= b[1] && R[1] + y < b[3]) c.inside++
        if (x < c.box[0]) c.box[0] = x
        if (y < c.box[1]) c.box[1] = y
        if (x + 1 > c.box[2]) c.box[2] = x + 1
        if (y + 1 > c.box[3]) c.box[3] = y + 1
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
            const k = ny * W + nx
            if (label[k]! < 0 && ink(k)) {
              label[k] = id
              stack.push(k)
            }
          }
      }
      comps.push(c)
    }
  }

  // Specks of a grainy background (many tiny components outside the box) are background:
  // letters are bigger, and never scattered all around the mark.
  const tiny = Math.max(4, Math.round(4 * s * s))
  const outsideSpecks = comps.filter((c) => c.area <= tiny && c.inside === 0).length
  const grainy = clean && outsideSpecks >= GRAINY_SPECKS
  // On grain, faint pixels on the far side of the header colour from the ink (black grain on a
  // near-black header behind a white name) are grain the letters' edges touch, not ink.
  if (grainy && !photo && comps.length && unGrain(comps, a0, W, at, bg)) labelInk()
  // On grain, a speck is anything under a small letter part's size (an eighth of the box's height, squared).
  const speck = Math.max(tiny, Math.round((0.12 * (b[3] - b[1])) ** 2))
  // Group components that sit close together (letters of a word, parts of a symbol).
  const bh = b[3] - b[1]
  const g = Math.max(2 * s, 0.3 * bh)
  if (clean && !photo) dropChrome(comps, b, R)
  // A component spanning the whole region (a header's edge line, a band) is page structure, not the mark.
  const structure = (c: Comp) =>
    c.drop === true ||
    (clean && ((c.box[0] === 0 && c.box[2] === W) || (c.box[1] === 0 && c.box[3] === H))) ||
    (grainy && c.area <= speck)
  const parent = comps.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < comps.length; i++)
    for (let j = i + 1; j < comps.length; j++) {
      if (structure(comps[i]!) || structure(comps[j]!)) continue
      const p = comps[i]!.box
      const q = comps[j]!.box
      const gx = Math.max(0, Math.max(p[0], q[0]) - Math.min(p[2], q[2]))
      const gy = Math.max(0, Math.max(p[1], q[1]) - Math.min(p[3], q[3]))
      if (gx <= g && gy <= g) parent[find(i)] = find(j)
    }
  const groups = new Map<number, { area: number; inside: number; members: number[] }>()
  comps.forEach((c, i) => {
    if (structure(c)) return
    const e = groups.get(find(i)) ?? { area: 0, inside: 0, members: [] }
    e.area += c.area
    e.inside += c.inside
    e.members.push(i)
    groups.set(find(i), e)
  })
  let chosen = [...groups.values()].filter((e) => e.inside >= 0.5 * e.area)
  if (!chosen.length) {
    const best = [...groups.values()].sort((p, q) => q.inside - p.inside)[0]
    chosen = best && best.inside > 0 ? [best] : []
  }
  // A widely spaced wordmark the box stops short of (a centred header's capitals).
  if (chosen.length)
    chosen = alongLine(
      chosen,
      [...groups.values()].filter((e) => !chosen.includes(e)),
      (i) => comps[i]!.box
    )
  const keep = new Set(chosen.flatMap((e) => e.members))
  const kept = [...keep].map((i) => comps[i]!)

  // Tight bounds (region coordinates); the box itself when nothing was found.
  let tb: Box = [b[0] - R[0], b[1] - R[1], b[2] - R[0], b[3] - R[1]]
  if (kept.length) {
    tb = [W, H, 0, 0]
    for (const c of kept) {
      tb = [
        Math.min(tb[0], c.box[0]),
        Math.min(tb[1], c.box[1]),
        Math.max(tb[2], c.box[2]),
        Math.max(tb[3], c.box[3]),
      ]
    }
  }
  const touches =
    clean &&
    kept.length > 0 &&
    ((tb[0] === 0 && R[0] > 0) ||
      (tb[1] === 0 && R[1] > 0) ||
      (tb[2] === W && R[2] < img.width) ||
      (tb[3] === H && R[3] < img.height))

  // Page structure is background too: the flood passes through it.
  const structural = new Set(comps.map((c, i) => (structure(c) ? i : -1)).filter((i) => i >= 0))
  const wall = (i: number) => ink(i) && !structural.has(label[i]!)
  // Background: reachable from the region's edges through non-ink, and enclosed non-ink.
  const outside = new Uint8Array(W * H)
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) seed(x, y)
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) seed(x, y)
  function seed(x: number, y: number) {
    const i = y * W + x
    if (outside[i] || wall(i)) return
    outside[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      const jx = j % W
      const jy = (j - jx) / W
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = jx + dx
        const ny = jy + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const k = ny * W + nx
        if (!outside[k] && !wall(k)) {
          outside[k] = 1
          stack.push(k)
        }
      }
    }
  }
  // Enclosed non-ink: a counter opens (transparent); a large inner face stays opaque.
  const solid = new Uint8Array(W * H)
  const markArea = Math.max(1, (tb[2] - tb[0]) * (tb[3] - tb[1]))
  const seen = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    if (outside[i] || wall(i) || seen[i]) continue
    const region: number[] = []
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      region.push(j)
      const jx = j % W
      const jy = (j - jx) / W
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = jx + dx
        const ny = jy + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const k = ny * W + nx
        if (!seen[k] && !outside[k] && !wall(k)) {
          seen[k] = 1
          stack.push(k)
        }
      }
    }
    // Over a photo, what the ink encloses is the photo: always open.
    if (!photo && region.length >= 0.15 * markArea) for (const j of region) solid[j] = 1
    else for (const j of region) outside[j] = 1
  }

  // Which pixels belong to the kept mark: its components, solid faces, and the soft ring beside them.
  const isMark = (i: number) => (label[i]! >= 0 && keep.has(label[i]!)) || solid[i] === 1
  const pad = Math.round(Math.max(2 * s, 0.08 * (tb[3] - tb[1])))
  const ox = tb[0] - pad
  const oy = tb[1] - pad
  const ow = tb[2] - tb[0] + 2 * pad
  const oh = tb[3] - tb[1] + 2 * pad
  const data = new Uint8Array(ow * oh * 4)
  /** A pixel of `set` within 2px. */
  const within = (x: number, y: number, set: Uint8Array) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && set[ny * W + nx]) return true
      }
    return false
  }
  const keptAt = (j: number) => label[j]! >= 0 && keep.has(label[j]!)
  /** The kept ink pixel within 2px that differs most from the background. */
  const strongest = (x: number, y: number) => {
    let best = -1
    let bd = 0
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !keptAt(ny * W + nx)) continue
        const d = okDist(at(nx, ny), bg)
        if (d > bd) {
          bd = d
          best = ny * W + nx
        }
      }
    return best
  }
  const project = (p: RGB, c: RGB) => {
    let num = 0
    let den = 0
    for (let ch = 0; ch < 3; ch++) {
      num += (p[ch]! - bg[ch]!) * (c[ch]! - bg[ch]!)
      den += (c[ch]! - bg[ch]!) ** 2
    }
    return den > 0 ? num / den : 1
  }
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const rx = ox + x
      const ry = oy + y
      if (rx < 0 || ry < 0 || rx >= W || ry >= H) continue
      const i = ry * W + rx
      const p = at(rx, ry)
      let a = 0
      let c = p
      if (!clean) a = rx >= tb[0] && rx < tb[2] && ry >= tb[1] && ry < tb[3] ? 1 : 0
      else if (photo) {
        // The ink's own colour, as solid as the pixel is near it; the photo goes.
        if (isMark(i) || strongest(rx, ry) >= 0) a = a0[i]!
        c = photo.ink
      } else if (solid[i] || (isMark(i) && within(rx, ry, solid) && !within(rx, ry, outside))) a = 1
      else if (isMark(i) || (outside[i] && a0[i]! > 0)) {
        // A blend of the background and the strongest ink nearby (an anti-aliased edge, or a
        // narrow gap blurred by resizing) is unmixed: p = a * ink + (1 - a) * bg. Other ink is solid.
        a = isMark(i) ? 1 : 0
        const k = strongest(rx, ry)
        if (k >= 0) {
          const kx = k % W
          const ink = at(kx, (k - kx) / W)
          const t = Math.min(1, Math.max(0, project(p, ink)))
          const mix: RGB = [0, 1, 2].map((ch) => bg[ch]! + t * (ink[ch]! - bg[ch]!)) as RGB
          if (!isMark(i) || okDist(mix, p) < 0.08) {
            a = t
            c = ink
          }
        }
      }
      const o = (y * ow + x) * 4
      data[o] = Math.round(c[0])
      data[o + 1] = Math.round(c[1])
      data[o + 2] = Math.round(c[2])
      data[o + 3] = Math.round(a * 255)
    }
  const image: Image = { width: ow, height: oh, data }
  // A flat cut is drawn larger, sharp; ink read off a photo, and hairlines, are too rough or fine to.
  const redraw = flat && strokeWidth(image) >= FINEST_STROKE * s
  const pngScale = redraw ? Math.min(MAX_SHARP, Math.max(1, Math.ceil(SHARP_PX / oh))) : 1
  const palette = paletteOf(image, () => true)
  const A = (x: number, y: number) =>
    x < 0 || y < 0 || x >= ow || y >= oh ? 0 : data[(y * ow + x) * 4 + 3]!
  const outline = paletteOf(image, (x, y) =>
    [A(x + 1, y), A(x - 1, y), A(x, y + 1), A(x, y - 1)].some((v) => v < 64)
  )
  const readsOn = (bgc: RGB) => reads(outline, bgc)
  const bounds: Box = [R[0] + tb[0], R[1] + tb[1], R[0] + tb[2], R[1] + tb[3]]
  // Beside the box, where a wordmark would run on, a strip hardly showing the header colour
  // (letters leave gaps and counters of it): the header is flat around the box but not beyond.
  const offShare = (x0: number, x1: number) => {
    let n = 0
    let off = 0
    for (let gy = b[1]; gy < b[3]; gy++)
      for (let gx = Math.max(R[0], x0); gx < Math.min(R[2], x1); gx++) {
        n++
        if (a0[(gy - R[1]) * W + gx - R[0]]! > 0) off++
      }
    return n ? off / n : 0
  }
  const side = b[3] - b[1]
  const busy =
    flat && Math.max(offShare(b[0] - side, b[0]), offShare(b[2], b[2] + side)) >= BUSY_SIDE
  return {
    touches,
    busy,
    cut: {
      image,
      png: encodePng(pngScale > 1 ? sharpened(image, pngScale) : image),
      pngScale,
      bounds,
      origin: [R[0] + ox, R[1] + oy],
      background: bg,
      palette,
      outline,
      readsOnLight: readsOn(LIGHT),
      readsOnDark: readsOn(DARK),
      clean,
      components: kept.length,
      geometry: geometryOf(image, s),
    },
  }
}
