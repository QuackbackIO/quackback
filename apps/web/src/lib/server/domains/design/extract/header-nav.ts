/**
 * The header's layout from the logo and menu boxes, and how the menu marks
 * its current item (a pill, a tab, a line under it, a heavier stroke, or its
 * own colour), from the pixels of the snapped menu row.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { deltaE00, okDist, type RGB } from './color'
import type { Box } from './kinds'
import type { Image } from './png'
import { median, medianColour, px, type GeometryOptions } from './pixels'
import { coverage, measureText } from './text-metrics'

// Header layout

export interface HeaderLayout {
  header: 'stacked' | 'inline' | 'centered'
  menuAlign: 'start' | 'centre'
}

/**
 * The header's layout from the logo and menu boxes: centred when the logo
 * sits in the middle, stacked when the menu is under it, else inline; an
 * inline menu is centred when it sits in the middle, well clear of the logo.
 */
export function headerLayout(
  logo: readonly number[] | null,
  nav: readonly number[] | null,
  imageWidth: number
): HeaderLayout | null {
  if (!logo) return null
  const W = imageWidth
  const logoCx = (logo[0]! + logo[2]!) / 2
  const centred = Math.abs(logoCx - W / 2) < 0.05 * W
  if (!nav) return centred ? { header: 'centered', menuAlign: 'centre' } : null
  const navH = nav[3]! - nav[1]!
  const below = nav[1]! >= logo[3]! - 0.25 * navH
  if (centred) return { header: 'centered', menuAlign: 'centre' }
  if (below) return { header: 'stacked', menuAlign: 'start' }
  const navCx = (nav[0]! + nav[2]!) / 2
  const middle = Math.abs(navCx - W / 2) < 0.06 * W && nav[0]! - logo[2]! > 0.08 * W
  return { header: 'inline', menuAlign: middle ? 'centre' : 'start' }
}

// The menu's current item

export type NavActiveStyle = 'pill' | 'tabs' | 'underline' | 'bold' | 'plain' | 'none'

export interface NavActive {
  /** How the current item stands out; `plain` is by colour alone, `none` when no item does. */
  style: NavActiveStyle
  /** The current item's index in `items`, or -1. */
  index: number
  /** The menu items found in the row, in image px. */
  items: Box[]
}

/**
 * Find the menu items in a snapped menu row (runs of inked columns, split at
 * gaps wider than the text is tall) and the one that stands out: a fill
 * behind it (a pill, or a tab when the fill reaches the header's foot), a
 * line under it, a heavier stroke, or its own colour. Nothing stands out on
 * most marketing pages, which have no current item.
 */
export function navActive(
  img: Image,
  nav: readonly number[] | null,
  opts: GeometryOptions & { header?: readonly number[] | null } = {}
): NavActive | null {
  if (!nav) return null
  const s = opts.scale ?? 1
  const c = coverage(img, nav)
  if (!c) return null
  const bg = c.frame
  const rowsWithInk: number[] = []
  for (let y = 0; y < c.h; y++) {
    let n = 0
    for (let x = 0; x < c.w; x++) n += c.a[y * c.w + x]! > 0.5 ? 1 : 0
    if (n) rowsWithInk.push(y)
  }
  if (!rowsWithInk.length) return null
  const textH = rowsWithInk[rowsWithInk.length - 1]! - rowsWithInk[0]! + 1
  const cols: boolean[] = []
  for (let x = 0; x < c.w; x++) {
    let on = false
    for (let y = 0; y < c.h && !on; y++) on = c.a[y * c.w + x]! > 0.5
    cols.push(on)
  }
  // Items: inked column runs joined across gaps narrower than the text is tall (word spaces).
  const runs: Array<[number, number]> = []
  let st = -1
  for (let x = 0; x <= c.w; x++) {
    const on = x < c.w && cols[x]!
    if (on && st < 0) st = x
    if (!on && st >= 0) {
      runs.push([st, x])
      st = -1
    }
  }
  const joined: Array<[number, number]> = []
  for (const r of runs) {
    const last = joined[joined.length - 1]
    if (last && r[0] - last[1] < 0.9 * textH) last[1] = r[1]
    else joined.push([r[0], r[1]])
  }
  // Each item's text rows; a thin full-width run under them, apart from them, is a line under the item.
  const inBoxLine: boolean[] = []
  const items: Box[] = joined
    .filter(([a, b]) => b - a >= 0.5 * textH)
    .map(([a, b]) => {
      const rowRuns: Array<[number, number]> = []
      let r0 = -1
      for (let y = 0; y <= c.h; y++) {
        let n = 0
        if (y < c.h) for (let x = a; x < b; x++) n += c.a[y * c.w + x]! > 0.5 ? 1 : 0
        if (n && r0 < 0) r0 = y
        if (!n && r0 >= 0) {
          rowRuns.push([r0, y])
          r0 = -1
        }
      }
      let line = false
      const last = rowRuns[rowRuns.length - 1]
      if (rowRuns.length >= 2 && last && last[1] - last[0] <= Math.max(2, Math.round(4 * s))) {
        let n = 0
        for (let x = a; x < b; x++) n += c.a[last[0] * c.w + x]! > 0.5 ? 1 : 0
        if (n >= 0.7 * (b - a)) {
          line = true
          rowRuns.pop()
        }
      }
      inBoxLine.push(line)
      const t = rowRuns[0]?.[0] ?? 0
      const btm = rowRuns[rowRuns.length - 1]?.[1] ?? c.h
      return [c.box[0] + a, c.box[1] + t, c.box[0] + b, c.box[1] + btm] as Box
    })
  const none: NavActive = { style: 'none', index: -1, items }
  if (items.length < 2) return none
  const unique = (flags: boolean[]) =>
    flags.filter(Boolean).length === 1 ? flags.indexOf(true) : -1
  // A fill behind an item: a ring around its text unlike the row's background, or a solid block.
  const fills = items.map((it) => {
    const h = it[3] - it[1]
    const padX = Math.max(3 * s, 0.35 * h)
    const padY = Math.max(2 * s, 0.25 * h)
    const ring: RGB[] = []
    for (let x = it[0]; x < it[2]; x += Math.max(1, Math.round(s))) {
      ring.push(px(img, x, it[1] - padY), px(img, x, it[3] - 1 + padY))
    }
    ring.push(
      px(img, it[0] - padX, (it[1] + it[3]) / 2),
      px(img, it[2] - 1 + padX, (it[1] + it[3]) / 2)
    )
    const ringC = medianColour(ring)
    let solid = 0
    for (let y = it[1]; y < it[3]; y++)
      for (let x = it[0]; x < it[2]; x++) solid += c.a[(y - c.box[1]) * c.w + (x - c.box[0])]!
    const share = solid / Math.max(1, (it[2] - it[0]) * (it[3] - it[1]))
    // A pill is one even colour that ends round the item: art or a gradient behind the
    // menu varies along the ring and runs on past it.
    const even = ring.filter((p) => okDist(p, ringC) < 0.03).length >= 0.7 * ring.length
    const outX = [it[0] - padX - 1.6 * h, it[2] - 1 + padX + 1.6 * h]
    const outY = [it[1] - padY, it[3] - 1 + padY]
    const ends =
      outX.flatMap((x) => outY.map((y) => okDist(px(img, x, y), bg) < 0.03)).filter(Boolean)
        .length >= 3
    return { ring: ringC, filled: (okDist(ringC, bg) > 0.03 && even && ends) || share > 0.75 }
  })
  const pillAt = unique(fills.map((f) => f.filled))
  if (pillAt >= 0) {
    const it = items[pillAt]!
    const hdr = opts.header
    // A tab: its fill runs down to the header's foot.
    const tab =
      !!hdr &&
      okDist(px(img, (it[0] + it[2]) / 2, hdr[3]! - 1 - s), fills[pillAt]!.ring) < 0.03 &&
      okDist(px(img, (it[0] + it[2]) / 2, hdr[3]! - 1 - s), bg) > 0.03
    return { style: tab ? 'tabs' : 'pill', index: pillAt, items }
  }
  // A line under an item: a thin run of rows below the text, unlike the background, across most of it.
  const lines = items.map((it, i) => {
    const h = it[3] - it[1]
    const from = it[3] + Math.max(1, Math.round(1 * s))
    const to = Math.min(img.height - 1, it[3] + Math.round(1.2 * h) + Math.round(8 * s))
    let run = 0
    let found = false
    let rowAt = -1
    for (let y = from; y <= to; y++) {
      let n = 0
      let tot = 0
      for (let x = it[0]; x < it[2]; x++) {
        tot++
        if (okDist(px(img, x, y), bg) > 0.1) n++
      }
      if (n >= 0.7 * tot) {
        if (!run) rowAt = y
        run++
      } else if (run > 0) break
    }
    if (run > 0 && run <= Math.max(2, Math.round(4 * s))) {
      // The line is the item's own: it ends within a little of the item's sides (an icon's
      // width), where a rule or the edge of a section runs on across the page.
      const off = (x: number) => okDist(px(img, x, rowAt), bg) > 0.1
      let l = it[0]
      while (l > 0 && off(l - 1)) l--
      let r = it[2]
      while (r < img.width && off(r)) r++
      const reach = 3 * h
      found = it[0] - l <= reach && r - it[2] <= reach
    }
    return found || inBoxLine[i]!
  })
  const lineAt = unique(lines)
  if (lineAt >= 0) return { style: 'underline', index: lineAt, items }
  if (items.length < 3) return none
  // A heavier stroke, or a colour of its own, against the rest agreeing.
  const metrics = items.map((it) => measureText(img, it, { scale: s }))
  const ratios = metrics.map((m) => m?.stemPerTall ?? 0)
  const boldAt = unique(
    ratios.map((r, i) => {
      const rest = ratios.filter((_, j) => j !== i && ratios[j]! > 0)
      // On a downscaled image a menu's stems are a pixel or less: weights cannot be told apart.
      return s >= 1 && r > 0 && rest.length >= 2 && r > 1.4 * median(rest)
    })
  )
  if (boldAt >= 0) return { style: 'bold', index: boldAt, items }
  const inks = metrics.map((m) => m?.ink ?? null)
  const colourAt = unique(
    inks.map((ink, i) => {
      if (!ink) return false
      const rest = inks.filter((x, j): x is RGB => j !== i && !!x)
      if (rest.length < 2) return false
      const restC = medianColour(rest)
      return deltaE00(ink, restC) > 12 && rest.every((x) => deltaE00(x, restC) < 6)
    })
  )
  if (colourAt >= 0) return { style: 'plain', index: colourAt, items }
  return none
}

// The menu's text

export interface NavText {
  /** The other items' ink, and the header colour under it. */
  ink: RGB
  on: RGB
  /**
   * How far toward the strongest text its header allows the ink goes, in log
   * contrast: 1 is black or white on it, 0 the header's own colour.
   */
  share: number
  /** In the page's text colour, as most brands' menus are, rather than a softer grey. */
  strong: boolean
}

/**
 * Where a menu's ink counts as the text colour (see NavText.share). X0 dev
 * and goal sites: the eight menus in their text colour read 0.82 (a money
 * transfer site's dark green on its lime header) to 1.0, the grey ones 0.52
 * (a bank) to 0.71 (a furniture retailer's #484848); a portal's softer grey reads about 0.68 on white.
 */
export const NAV_STRONG_FROM = 0.75

const relLum = ([r, g, b]: RGB) => {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [relLum(a), relLum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * The menu's text colour, from its items other than the current one (which
 * may be heavier, coloured or on a fill): the median of their inks, against
 * the header behind them.
 */
export function navText(img: Image, nav: NavActive | null): NavText | null {
  if (!nav) return null
  const reads = nav.items
    .filter((_, i) => i !== nav.index)
    .map((item) => coverage(img, item))
    .filter((c): c is NonNullable<typeof c> => !!c)
  if (!reads.length) return null
  const ink = medianColour(reads.map((c) => c.ink))
  const on = medianColour(reads.map((c) => c.frame))
  const most = Math.max(ratio([0, 0, 0], on), ratio([255, 255, 255], on))
  const share = most > 1 ? Math.log(ratio(ink, on)) / Math.log(most) : 0
  return { ink, on, share: +share.toFixed(3), strong: share >= NAV_STRONG_FROM }
}
