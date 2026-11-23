/**
 * The static read's font files: the ones a page's own `@font-face` rules
 * serve for the family its words are set in, chosen as the browser reader
 * chooses them (../browser/font-faces.ts), fetched within the read's budget.
 * What may be done with them is site-font.ts's call.
 */
import { parseFontFaces, pickSiteFont, type FontPick } from '../browser/font-faces'
import { SITE_FONT_MAX_BYTES, type SiteFontInput } from './site-font'
import type { FetchedBody, FontFact, SiteFacts, SiteFetchKind, SiteRead } from './types'

/**
 * The text's and the headings' own font files, read so a site read without a
 * browser still brings an open-licence font along. Undefined when the page
 * serves neither.
 */
export async function readPageFonts(
  fonts: SiteFacts['fonts'],
  sheets: ReadonlyArray<{ url: string; css: string }>,
  get: BudgetGet
): Promise<SiteRead['fonts']> {
  const [text, headings] = await Promise.all([
    readSiteFontFiles(fonts.body, sheets, get, 'text'),
    readSiteFontFiles(fonts.heading, sheets, get, 'headings'),
  ])
  if (!text && !headings) return undefined
  return { ...(text ? { text } : {}), ...(headings ? { headings } : {}) }
}

/** One fetch within the read's budget (site-read.ts). */
type BudgetGet = (url: string, kind: SiteFetchKind, maxBytes: number) => Promise<FetchedBody | null>

const ok = (status: number) => status >= 200 && status < 300

/**
 * The files of the family `fact` sets words in, for site-font.ts to say what
 * Import may do with them. Null when the page has no rule for that family (a
 * system font, or one only a font service serves through script). A file
 * over the copy limit is left out and said so.
 */
export async function readSiteFontFiles(
  fact: FontFact | null,
  sheets: ReadonlyArray<{ url: string; css: string }>,
  get: BudgetGet,
  use: 'text' | 'headings'
): Promise<SiteFontInput | null> {
  if (!fact) return null
  const faces = sheets.flatMap((sheet) => parseFontFaces(sheet.css, sheet.url))
  const stack = fact.stack.map((family) => JSON.stringify(family)).join(', ')
  const pick = pickSiteFont(stack, faces, new Set(), use)
  if (!pick) return null
  if (pick.service) return { family: pick.family, service: true, files: [] }
  const files: SiteFontInput['files'] = []
  let tooLarge = false
  for (const { url, ...weights } of pick.picks satisfies FontPick[]) {
    // One byte over the limit is enough to know a file is too large to copy.
    const res = await get(url, 'font', SITE_FONT_MAX_BYTES + 1)
    const large = res !== null && res.body.byteLength > SITE_FONT_MAX_BYTES
    if (large) tooLarge = true
    // Without the first file there is no family to copy: the second alone is not taken.
    if (!res || !ok(res.status) || large) {
      if (files.length === 0) break
      continue
    }
    files.push({ url, ...weights, bytes: res.body })
  }
  return { family: pick.family, ...(tooLarge ? { tooLarge } : {}), files }
}
