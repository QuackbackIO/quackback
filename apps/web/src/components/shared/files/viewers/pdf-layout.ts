/**
 * The PDF engine's arithmetic, kept apart from pdf.js so it can be tested
 * without a canvas: fitting pages to the desk, which page is current while
 * scrolling, which pages are worth drawing, and find-in-document matching.
 */
import { MAX_FIND_MATCHES } from './find-limit'

/** Fit-to-width never enlarges pages past this, so a wide dialog stays readable. */
const FIT_MAX = 1.25
/** pdf.js page units are points (1/72 in); CSS pixels are 1/96 in. */
export const PDF_TO_CSS = 96 / 72

/**
 * The zoom at which a page `pageWidthPt` wide fills the desk, less its
 * horizontal padding. 1 means the page at its real size.
 */
export function fitWidthZoom(deskWidth: number, pageWidthPt: number, padding: number): number {
  const available = deskWidth - padding
  if (available <= 0 || pageWidthPt <= 0) return 1
  return Math.min(FIT_MAX, available / (pageWidthPt * PDF_TO_CSS))
}

/**
 * The 1-based page under the middle of the viewport. `tops` and `heights`
 * are each page's offset and height within the scrolling desk; a gap between
 * pages belongs to the page above it.
 */
export function currentPage(
  tops: readonly number[],
  heights: readonly number[],
  scrollTop: number,
  viewportHeight: number
): number {
  if (tops.length === 0) return 1
  const middle = scrollTop + viewportHeight / 2
  let page = 1
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= middle) page = i + 1
    else break
  }
  // Past the end of the last page, stay on it.
  const last = tops.length - 1
  if (middle > tops[last]! + heights[last]!) return tops.length
  return page
}

/** The pages to draw: every visible page and one either side, in order. */
export function pagesNear(visible: ReadonlySet<number>, total: number): number[] {
  const pages = new Set<number>()
  for (const page of visible) {
    for (const p of [page - 1, page, page + 1]) {
      if (p >= 1 && p <= total) pages.add(p)
    }
  }
  return [...pages].sort((a, b) => a - b)
}

export interface TextMatch {
  /** 1-based page. */
  page: number
  /** Offsets into that page's joined text. */
  start: number
  end: number
}

/**
 * Every case-insensitive occurrence of `query` in each page's text, up to
 * `MAX_FIND_MATCHES`.
 */
export function findMatches(pageTexts: readonly string[], query: string): TextMatch[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return []
  const matches: TextMatch[] = []
  for (const [i, text] of pageTexts.entries()) {
    const haystack = text.toLocaleLowerCase()
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      matches.push({ page: i + 1, start: at, end: at + needle.length })
      if (matches.length >= MAX_FIND_MATCHES) return matches
      from = at + needle.length
    }
  }
  return matches
}

/** The next (or previous, `direction` -1) match index, wrapping; -1 when none. */
export function stepMatch(index: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1
  if (index < 0) return direction === 1 ? 0 : count - 1
  return (index + direction + count) % count
}

/** Each page's offset down the desk: padding above, then pages and gaps. */
export function pageTops(heights: readonly number[], padding: number, gap: number): number[] {
  const tops: number[] = []
  let y = padding
  for (const height of heights) {
    tops.push(y)
    y += height + gap
  }
  return tops
}

export interface PageTextIndex {
  /** The page's text runs joined, with a newline where a run ends a line. */
  text: string
  /** Where each run starts in `text`, in the same order as the text layer's spans. */
  starts: number[]
  lengths: number[]
}

export function pageTextIndex(items: readonly { str: string; hasEOL: boolean }[]): PageTextIndex {
  let text = ''
  const starts: number[] = []
  const lengths: number[] = []
  for (const item of items) {
    starts.push(text.length)
    lengths.push(item.str.length)
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return { text, starts, lengths }
}

export interface HighlightRange {
  /** Index of the text run (and its span in the text layer). */
  item: number
  start: number
  end: number
  active: boolean
}

/** One page's matches as ranges within its text runs, in run order. */
export function highlightRanges(
  index: PageTextIndex,
  matches: readonly TextMatch[],
  activeMatch: number
): HighlightRange[] {
  const ranges: HighlightRange[] = []
  matches.forEach((match, m) => {
    for (let item = 0; item < index.starts.length; item++) {
      const runStart = index.starts[item]!
      const runEnd = runStart + index.lengths[item]!
      const start = Math.max(match.start, runStart)
      const end = Math.min(match.end, runEnd)
      if (start < end) {
        ranges.push({
          item,
          start: start - runStart,
          end: end - runStart,
          active: m === activeMatch,
        })
      }
    }
  })
  return ranges.sort((a, b) => a.item - b.item || a.start - b.start)
}

/** Why a document could not be shown: too slow to open, or unreadable. */
export function pdfFailure(error: unknown): 'too_large' | 'corrupt' {
  return error instanceof Error && error.name === 'BudgetTimeoutError' ? 'too_large' : 'corrupt'
}

/** The largest canvas one page may use, in device pixels. */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024

/** Device pixels per CSS pixel for a page's canvas: the screen's ratio, within budget. */
export function canvasScale(cssWidth: number, cssHeight: number, devicePixelRatio: number): number {
  const ratio = Math.max(1, devicePixelRatio || 1)
  const area = cssWidth * cssHeight
  if (area <= 0) return ratio
  return Math.min(ratio, Math.sqrt(MAX_CANVAS_PIXELS / area))
}

export interface LinkBox {
  href: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where a page's web links sit, from its annotations. Only `Link`
 * annotations with an http(s) URL count: no internal destinations, no
 * mail or other schemes, no form widgets. `toViewport` maps a PDF point to
 * page coordinates.
 */
export function linkBoxes(
  annotations: readonly Record<string, unknown>[],
  toViewport: (x: number, y: number) => number[]
): LinkBox[] {
  const boxes: LinkBox[] = []
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link') continue
    const href = safeLinkUrl(typeof annotation.url === 'string' ? annotation.url : null)
    const rect = annotation.rect
    if (!href || !Array.isArray(rect) || rect.length !== 4) continue
    const [x1, y1] = toViewport(Number(rect[0]), Number(rect[1]))
    const [x2, y2] = toViewport(Number(rect[2]), Number(rect[3]))
    if (![x1, y1, x2, y2].every((v) => Number.isFinite(v))) continue
    boxes.push({
      href,
      left: Math.min(x1!, x2!),
      top: Math.min(y1!, y2!),
      width: Math.abs(x2! - x1!),
      height: Math.abs(y2! - y1!),
    })
  }
  return boxes
}

/** A link annotation's URL when it is a plain web link, else null. */
export function safeLinkUrl(url: string | undefined | null): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
}
