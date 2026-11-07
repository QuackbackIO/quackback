/**
 * The site's own marks on a hero photo: small type, badges, price tags,
 * labels and controls laid over it, which a crop must leave out. A
 * photograph's edges are mostly soft or single outlines; set type is dense
 * hard edges, glyph after glyph, so a cluster of small squares packed with
 * hard edges is a mark. The finder's own boxes that sit on the photo (a card,
 * a link, a field) count too.
 *
 * Then the largest part of the photo clear of every mark and word, when one
 * is large enough to show.
 *
 * Pure: no app imports, so the offline harness can load it.
 */
import type { Box } from './kinds'
import type { Image } from './png'

/** Square edge in CSS px. */
const CELL = 8
/** A hard edge: this luminance step between neighbouring pixels. */
const HARD = 60
/** A square is set type when this share of its pixels sit on a hard edge (an outline through it holds a fifth at most). */
const DENSE = 0.22
/** A mark holds this many dense squares, at this mean share: a word or a badge, not a glint. */
const MARK_CELLS = 6
const MARK_DENSITY = 0.3
/** A cluster fills this share of its box at least: type is packed, an outline runs thin across its box. */
const MARK_FILL = 0.25
/** Dense clusters this close are one mark (the words of one label), CSS px. */
const JOIN = 16
/** Room kept round a mark, CSS px: a badge's plate runs past its words. */
export const MARK_PAD = 24
/** A finder box on the photo is a mark below this share of it (a larger one frames the photo). */
const BOX_SHARE = 0.25

const lumAt = (d: Uint8Array, i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const near = (a: Box, b: Box, gap: number) =>
  a[0] - gap < b[2] && b[0] - gap < a[2] && a[1] - gap < b[3] && b[1] - gap < a[3]

/**
 * Clusters of set type and graphics inside the region, leaving out those
 * within the words given (the site's headline and buttons, handled apart).
 */
export function typeMarks(img: Image, region: Box, words: Box[] = []): Box[] {
  const x0 = Math.max(0, region[0])
  const y0 = Math.max(0, region[1])
  const cols = Math.floor((Math.min(img.width, region[2]) - x0) / CELL)
  const rows = Math.floor((Math.min(img.height, region[3]) - y0) / CELL)
  if (cols < 1 || rows < 1) return []
  const share = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let n = 0
      for (let y = y0 + r * CELL; y < y0 + (r + 1) * CELL; y++)
        for (let x = x0 + c * CELL; x < x0 + (c + 1) * CELL; x++) {
          const i = (y * img.width + x) * 4
          const l = lumAt(img.data, i)
          const lx = x > 0 ? lumAt(img.data, i - 4) : l
          const ly = y > 0 ? lumAt(img.data, i - img.width * 4) : l
          if (Math.abs(l - lx) >= HARD || Math.abs(l - ly) >= HARD) n++
        }
      share[r * cols + c] = n / (CELL * CELL)
    }
  // Dense squares, joined where they touch.
  const seen = new Uint8Array(cols * rows)
  let groups: Array<{ box: Box; cells: number; sum: number }> = []
  for (let t = 0; t < cols * rows; t++) {
    if (share[t]! < DENSE || seen[t]) continue
    const stack = [t]
    seen[t] = 1
    const g = { box: [cols, rows, -1, -1] as Box, cells: 0, sum: 0 }
    while (stack.length) {
      const u = stack.pop()!
      const ur = Math.floor(u / cols)
      const uc = u % cols
      g.cells++
      g.sum += share[u]!
      g.box = [
        Math.min(g.box[0], uc),
        Math.min(g.box[1], ur),
        Math.max(g.box[2], uc),
        Math.max(g.box[3], ur),
      ]
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const vr = ur + dr
          const vc = uc + dc
          if (vr < 0 || vr >= rows || vc < 0 || vc >= cols) continue
          const v = vr * cols + vc
          if (share[v]! >= DENSE && !seen[v]) {
            seen[v] = 1
            stack.push(v)
          }
        }
    }
    const span = (g.box[2] - g.box[0] + 1) * (g.box[3] - g.box[1] + 1)
    if (g.cells < MARK_FILL * span) continue
    groups.push({
      ...g,
      box: [
        x0 + g.box[0] * CELL,
        y0 + g.box[1] * CELL,
        x0 + (g.box[2] + 1) * CELL,
        y0 + (g.box[3] + 1) * CELL,
      ],
    })
  }
  // Clusters close together are one label.
  for (let joined = true; joined;) {
    joined = false
    const next: typeof groups = []
    for (const g of groups) {
      const m = next.find((n) => near(n.box, g.box, JOIN))
      if (!m) {
        next.push({ ...g })
        continue
      }
      m.box = [
        Math.min(m.box[0], g.box[0]),
        Math.min(m.box[1], g.box[1]),
        Math.max(m.box[2], g.box[2]),
        Math.max(m.box[3], g.box[3]),
      ]
      m.cells += g.cells
      m.sum += g.sum
      joined = true
    }
    groups = next
  }
  return groups
    .filter((g) => g.cells >= MARK_CELLS && g.sum / g.cells >= MARK_DENSITY)
    .map((g) => g.box)
    .filter((b) => !words.some((w) => overlap(b, w) >= 0.6 * area(b)))
}

/** The finder's boxes on the photo that are not its words: a card, a link, a field, a heading. */
export function boxMarks(region: Box, boxes: Array<Box | null | undefined>): Box[] {
  return boxes
    .filter((b): b is Box => !!b)
    .filter((b) => overlap(b, region) > 0 && area(b) < BOX_SHARE * area(region))
}

/**
 * The largest part of `within` clear of every box given, at least `minW` by
 * `minH`, in whole squares; null when none is.
 */
export function clearPart(within: Box, blocks: Box[], minW: number, minH: number): Box | null {
  const cols = Math.floor((within[2] - within[0]) / CELL)
  const rows = Math.floor((within[3] - within[1]) / CELL)
  if (cols < 1 || rows < 1) return null
  const blocked = new Uint8Array(cols * rows)
  for (const b of blocks) {
    const c0 = Math.max(0, Math.floor((b[0] - within[0]) / CELL))
    const c1 = Math.min(cols, Math.ceil((b[2] - within[0]) / CELL))
    const r0 = Math.max(0, Math.floor((b[1] - within[1]) / CELL))
    const r1 = Math.min(rows, Math.ceil((b[3] - within[1]) / CELL))
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) blocked[r * cols + c] = 1
  }
  if (!blocked.some((v) => v)) return within
  const minC = Math.ceil(minW / CELL)
  const minR = Math.ceil(minH / CELL)
  let best: { a: number; box: Box } | null = null
  const colBlocked = new Uint8Array(cols)
  for (let top = 0; top < rows; top++) {
    colBlocked.fill(0)
    for (let bottom = top; bottom < rows; bottom++) {
      for (let c = 0; c < cols; c++) if (blocked[bottom * cols + c]) colBlocked[c] = 1
      const h = bottom - top + 1
      if (h < minR) continue
      let run = 0
      for (let c = 0; c <= cols; c++) {
        if (c < cols && !colBlocked[c]) {
          run++
          continue
        }
        if (run >= minC && (!best || run * h > best.a)) {
          const left = c - run
          best = {
            a: run * h,
            box: [
              within[0] + left * CELL,
              within[1] + top * CELL,
              c === cols ? within[2] : within[0] + c * CELL,
              bottom === rows - 1 ? within[3] : within[1] + (bottom + 1) * CELL,
            ],
          }
        }
        run = 0
      }
    }
  }
  return best?.box ?? null
}
