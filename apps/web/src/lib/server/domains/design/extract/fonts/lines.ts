/**
 * Which words sit on which measured line. The text (read by the model; in
 * the spike the truth text, cut at 80 characters) is split into lines so
 * that each line's predicted width, from a generic sans width table at the
 * size the line's height suggests, matches its measured ink width. A text
 * that may be cut short fills its last line only partly; such lines are not
 * used for matching.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */

// Helvetica advance widths (1/1000 em), a generic sans reference.
const W: Record<string, number> = {
  ' ': 278,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '.': 278,
  ',': 278,
  '-': 333,
  '–': 556,
  '—': 1000,
  '&': 667,
  "'": 191,
  '’': 222,
  '?': 556,
  '!': 278,
  ':': 278,
  ';': 278,
  '%': 889,
  '+': 584,
  '(': 333,
  ')': 333,
  '"': 355,
  '/': 278,
}
export const textEm = (s: string) =>
  [...s].reduce((t, c) => t + (W[c] ?? (/\d/.test(c) ? 556 : 556)), 0) / 1000

export interface Assignment {
  lines: Array<string | null>
  complete: boolean[]
  score: number
}

/**
 * @param widths measured ink width per line (px)
 * @param size the font size the lines' height suggests (px)
 * @param truncated the text may stop before the end of the visible text
 * @param more the box may show only the text's first lines: its lines may
 *   hold the first words alone, each of them complete
 */
export function assignLines(
  widths: number[],
  words: string[],
  size: number,
  truncated: boolean,
  gapWords?: number[],
  more = false
): Assignment | null {
  const L = widths.length
  let best: Assignment | null = null
  // Breaks: lines 0..L-1 get consecutive runs of words; the final run may be partial when truncated.
  const rec = (li: number, wi: number, acc: string[][]) => {
    if (li === L || wi === words.length) {
      const used = acc.reduce((s, x) => s + x.length, 0)
      if (used !== words.length && !(more && acc.length === L)) return
      if (!truncated && acc.length !== L) return
      const lines: Array<string | null> = widths.map((_, i) => (acc[i] ? acc[i]!.join(' ') : null))
      // A cut text's last line is partial, unless it fills its line as the others do.
      for (const lastComplete of truncated ? [false, true] : [true]) {
        const complete = lines.map((t, i) => t !== null && (i < acc.length - 1 || lastComplete))
        let score = lastComplete ? 0 : 0.004,
          n = 0
        const logs: number[] = []
        for (let i = 0; i < L; i++) {
          const t = lines[i]
          if (t === null) continue
          const r = Math.log(widths[i]! / (textEm(t) * size))
          const nw = t.split(' ').length,
            gw = gapWords?.[i]
          if (complete[i]) {
            logs.push(r)
            n++
            if (gw) score += 0.03 * Math.abs(nw - gw)
          } else if (gw && nw > gw) score += 0.03 * (nw - gw)
          else if (r < -0.1) score += 4 * (r + 0.1) ** 2 // a partial line cannot be wider than measured
        }
        if (logs.length) {
          const m = logs.reduce((a, b) => a + b) / logs.length
          score += 2 * logs.reduce((s, r) => s + (r - m) ** 2, 0) + 0.5 * m * m
        }
        if (!n) score += 1
        if (!best || score < best.score) best = { lines, complete, score }
      }
      return
    }
    for (let k = 1; wi + k <= words.length; k++)
      rec(li + 1, wi + k, [...acc, words.slice(wi, wi + k)])
  }
  rec(0, 0, [])
  return best
}

/** The words of a possibly cut text: an 80-character text may end mid-word, so its last word is dropped. */
export function textWords(text: string, cut = 80): { words: string[]; truncated: boolean } {
  const truncated = text.length >= cut
  let words = text.trim().split(/\s+/).filter(Boolean)
  if (truncated && !/\s$/.test(text)) words = words.slice(0, -1)
  return { words, truncated }
}

/** Words on a line from its gaps: gaps above the largest jump in sorted gap widths are word spaces. */
export function gapWordCount(gaps: Array<[number, number]>, height: number): number {
  const ws = gaps.map((g) => g[1] - g[0]).sort((a, b) => a - b)
  if (!ws.length) return 1
  // Word spaces are at least ~0.12 of the line's tall height; letter gaps at most ~0.12.
  let cut = -1,
    jump = 0
  for (let i = 0; i < ws.length; i++) {
    const prev = i ? ws[i - 1]! : 0
    const j = ws[i]! - prev
    if (ws[i]! >= 0.1 * height && j > jump) {
      jump = j
      cut = i
    }
  }
  if (cut < 0) return 1
  return ws.length - cut + 1
}
