/**
 * Which font files a page's text is set in. The measurement lists the
 * `@font-face` rules it could read (page-measure.ts); the reader adds those of
 * stylesheets the page itself may not read (another origin's), from the text
 * the browser loaded. From them: the regular and the bold file of the family
 * the words are set in. Files a font service serves are named, never taken.
 * Plain functions, so the choice is tested and the same wherever it runs.
 */
import { isSymbolFace } from '@/lib/shared/theme/font-names'
import { isFontServiceUrl } from '../site/font-services'
import type { PageFontFace, PageFontSource } from './page-measure.types'

export type { PageFontFace, PageFontSource }

/** One file to copy: a weight, or the weights a variable font covers. */
export interface FontPick {
  url: string
  weight: number
  weightTo?: number
}

export interface SiteFontPick {
  /** The family as the page's stylesheet names it. */
  family: string
  /** A font service serves it: nothing is taken. */
  service: boolean
  picks: FontPick[]
}

const MAX_PARSED_FACES = 200
const GENERIC =
  /^(serif|sans-serif|monospace|cursive|fantasy|math|fangsong|emoji|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|-apple-system|blinkmacsystemfont|inherit|initial|unset)$/i

const unquote = (name: string) =>
  name
    .trim()
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim()

/** The names in a font-family value, unquoted, in order. */
export const stackFamilies = (stack: string): string[] =>
  (stack.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map(unquote).filter(Boolean)

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** A `font-weight` descriptor as the weights it covers, 100 to 900. */
function weightsOf(descriptor: string): [number, number] | null {
  const parts = descriptor
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => (part === 'normal' || part === '' ? 400 : part === 'bold' ? 700 : Number(part)))
  if (parts.length === 0 || parts.length > 2 || parts.some((n) => !Number.isFinite(n))) return null
  const clamp = (n: number) => Math.min(900, Math.max(100, Math.round(n)))
  const [low, high] = [clamp(Math.min(...parts)), clamp(Math.max(...parts))]
  return [low, high]
}

/** Whether a `unicode-range` holds the letter A: the file with the Latin letters. */
function holdsLatin(range: string | undefined): boolean {
  if (!range?.trim()) return true
  const A = 0x41
  return range.split(',').some((part) => {
    const match = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim())
    if (!match) return false
    const start = parseInt(match[1]!.replace(/\?/g, '0'), 16)
    const end = match[2] ? parseInt(match[2], 16) : parseInt(match[1]!.replace(/\?/g, 'f'), 16)
    return start <= A && A <= end
  })
}

const FORMAT_RANK: Record<string, number> = { woff2: 0, woff: 1, ttf: 2, otf: 2 }

/** The format a source is in, by its hint or its extension. */
function formatOf(source: PageFontSource): string | null {
  const hint = source.format?.toLowerCase() ?? ''
  if (hint.startsWith('woff2')) return 'woff2'
  if (hint.startsWith('woff')) return 'woff'
  if (hint.startsWith('truetype')) return 'ttf'
  if (hint.startsWith('opentype')) return 'otf'
  if (hint) return null
  let path: string
  try {
    path = new URL(source.url).pathname
  } catch {
    return null
  }
  const ext = /\.(woff2|woff|ttf|otf)$/i.exec(path)?.[1]?.toLowerCase()
  return ext ?? null
}

/** The best web address of a face: WOFF2, else WOFF, else TTF or OTF. */
function bestSource(face: PageFontFace): string | null {
  const usable = face.src
    .filter((source) => /^https?:\/\//i.test(source.url))
    .map((source) => ({ url: source.url, format: formatOf(source) }))
    .filter((source): source is { url: string; format: string } => source.format !== null)
    .sort((a, b) => FORMAT_RANK[a.format]! - FORMAT_RANK[b.format]!)
  return usable[0]?.url ?? null
}

/**
 * The files of the family `stack` sets the text in: its regular (400) and its
 * bold (700, else 600), upright, the Latin file of a font split by script, or
 * the one file of a variable font. Where several rules give the same weight,
 * the file the browser loaded is the one in use. Null when the page has no `@font-face` for
 * any family the stack names (its text is set in a system font).
 *
 * For `headings` only the weights headings are set in are taken, so a page
 * never loads a cut it does not draw: the semibold (600) and the bold (700),
 * or the one variable file; a display face with neither gives its heaviest.
 */
export function pickSiteFont(
  stack: string,
  faces: readonly PageFontFace[],
  /** The addresses the browser loaded: among rules for one weight, the file in use. */
  loaded: ReadonlySet<string> = new Set(),
  use: 'text' | 'headings' = 'text'
): SiteFontPick | null {
  // A stack often names an installed copy first (`"Adobe Clean", adobe-clean`):
  // the family is the first one the page has files for.
  const family = stackFamilies(stack)
    // An emoji, flag or icon face at the head of a stack is not what the words are set in.
    .filter((name) => !GENERIC.test(name) && !isSymbolFace(name))
    .find((name) => faces.some((face) => sameName(unquote(face.family), name)))
  if (!family) return null
  const own = faces.filter((face) => sameName(unquote(face.family), family))
  if (own.some((face) => face.src.some((source) => isFontServiceUrl(source.url))))
    return { family, service: true, picks: [] }

  const upright = own
    .filter((face) => !/italic|oblique/i.test(face.style) && holdsLatin(face.range))
    .map((face) => ({ url: bestSource(face), weights: weightsOf(face.weight) }))
    .filter(
      (face): face is { url: string; weights: [number, number] } =>
        face.url !== null && face.weights !== null
    )
  // Several rules for one weight: the file the browser loaded, else the last (which CSS lets win).
  const covering = (weight: number) => {
    const matching = upright.filter(({ weights }) => weights[0] <= weight && weight <= weights[1])
    return matching.find((face) => loaded.has(face.url)) ?? matching.at(-1)
  }
  // A site with no 400 sets its words in the nearest it has.
  const regular =
    covering(400) ??
    upright
      .filter(({ weights }) => weights[0] >= 300 && weights[1] <= 500)
      .sort((a, b) => Math.abs(a.weights[0] - 400) - Math.abs(b.weights[0] - 400))[0]
  const pickOf = (face: (typeof upright)[number], weight: number): FontPick =>
    face.weights[0] === face.weights[1]
      ? { url: face.url, weight: face.weights[0] }
      : face.weights[0] <= weight && weight <= face.weights[1] && face.weights[1] > face.weights[0]
        ? { url: face.url, weight: face.weights[0], weightTo: face.weights[1] }
        : { url: face.url, weight }
  if (use === 'headings') {
    const semibold = covering(600)
    const heavy = covering(700)
    // Neither: the heaviest cut the face has stands for both.
    const heaviest = [...upright].sort((a, b) => b.weights[1] - a.weights[1])[0]
    const first = semibold ?? heavy ?? heaviest
    if (!first) return { family, service: false, picks: [] }
    const picks = [pickOf(first, semibold ? 600 : heavy ? 700 : first.weights[1])]
    if (heavy && heavy.url !== first.url) picks.push(pickOf(heavy, 700))
    return { family, service: false, picks }
  }
  if (!regular) return { family, service: false, picks: [] }
  const picks = [pickOf(regular, 400)]
  const bold = covering(700) ?? covering(600)
  if (bold && bold.url !== regular.url) picks.push(pickOf(bold, bold.weights[0] <= 700 ? 700 : 600))
  return { family, service: false, picks }
}

/**
 * The `@font-face` rules in a stylesheet's text, with each address made
 * absolute against the stylesheet's own. For stylesheets the page may not
 * read itself; a plain scan, since only these rules are wanted.
 */
export function parseFontFaces(css: string, sheetUrl: string): PageFontFace[] {
  const faces: PageFontFace[] = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    if (faces.length >= MAX_PARSED_FACES) break
    const body = block[1]!
    const value = (name: string) =>
      new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(body)?.[1]?.trim()
    const family = value('font-family')
    // Every `src` the rule gives: an old one for one browser, then the list.
    const src = [...body.matchAll(/(?:^|;)\s*src\s*:\s*([^;]+)/gi)].map((m) => m[1]).join(',')
    if (!family || !src) continue
    const sources: PageFontSource[] = []
    for (const match of src.matchAll(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)(?:\s*format\(\s*["']?([\w-]+)["']?\s*\))?/gi
    )) {
      const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
      if (!raw) continue
      try {
        const url = new URL(raw, sheetUrl).href
        sources.push(match[4] ? { url, format: match[4] } : { url })
      } catch {
        // An address that does not parse is no source.
      }
    }
    const range = value('unicode-range')
    faces.push({
      family: unquote(family),
      weight: value('font-weight') ?? '400',
      style: value('font-style') ?? 'normal',
      ...(range ? { range } : {}),
      src: sources,
    })
  }
  return faces
}
