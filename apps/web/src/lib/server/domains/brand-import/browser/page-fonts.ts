/**
 * The `@font-face` rules a rendered page declares for the families its text
 * is set in, for the reader to find the font files (font-faces.ts). A
 * stylesheet from another origin cannot be read from inside the page: its
 * address is handed back instead, and the reader reads the text the browser
 * loaded. Self-contained, like the measurement: it is sent as its source
 * text and runs in the page, so it refers to nothing outside its own body.
 */
import type { PageFontFace } from './page-measure.types'

export interface PageFonts {
  fontFaces: PageFontFace[]
  /** Stylesheets the page may not read itself. */
  fontSheets: string[]
}

/** The rules for the families `stacks` (font-family values) name. */
export function listPageFonts(stacks: string[]): PageFonts {
  const FACES_MAX = 80
  const SHEETS_MAX = 12
  const namedFamilies = new Set<string>()
  for (const stack of stacks)
    for (const name of (stack || '').split(','))
      namedFamilies.add(
        name
          .trim()
          .replace(/^['"]|['"]$/g, '')
          .trim()
          .toLowerCase()
      )
  const fontFaces: PageFontFace[] = []
  const fontSheets: string[] = []
  const sourcesOf = (src: string, base: string) => {
    const sources: PageFontFace['src'] = []
    const pattern =
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)(?:\s*format\(\s*["']?([\w-]+)["']?\s*\))?/gi
    for (let match = pattern.exec(src); match; match = pattern.exec(src)) {
      const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
      if (!raw || raw.startsWith('data:')) continue
      try {
        const url = new URL(raw, base).href
        sources.push(match[4] ? { url, format: match[4] } : { url })
      } catch {
        // Not an address.
      }
    }
    return sources
  }
  const readRules = (rules: CSSRuleList, base: string, depth: number) => {
    for (const rule of rules) {
      if (fontFaces.length >= FACES_MAX) return
      // By rule type, not class: 5 is @font-face, 3 is @import.
      if (rule.type === 5) {
        const style = (rule as CSSFontFaceRule).style
        const family = style
          .getPropertyValue('font-family')
          .trim()
          .replace(/^['"]|['"]$/g, '')
          .trim()
        if (!namedFamilies.has(family.toLowerCase())) continue
        // Not every browser hands this descriptor out by name: the rule's own text has it.
        const range = (
          style.getPropertyValue('unicode-range') ||
          /unicode-range\s*:\s*([^;}]+)/i.exec(rule.cssText)?.[1] ||
          ''
        ).trim()
        fontFaces.push({
          family,
          weight: style.getPropertyValue('font-weight').trim() || '400',
          style: style.getPropertyValue('font-style').trim() || 'normal',
          src: sourcesOf(style.getPropertyValue('src'), base),
          ...(range ? { range: range.slice(0, 400) } : {}),
        })
      } else if (rule.type === 3) {
        const imported = (rule as CSSImportRule).styleSheet
        if (imported && depth < 3) readSheet(imported, depth + 1)
      } else if ('cssRules' in rule) {
        readRules((rule as CSSGroupingRule).cssRules, base, depth)
      }
    }
  }
  const readSheet = (sheet: CSSStyleSheet, depth: number) => {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      if (sheet.href && /^https?:/.test(sheet.href) && fontSheets.length < SHEETS_MAX)
        fontSheets.push(sheet.href)
      return
    }
    readRules(rules, sheet.href || document.baseURI, depth)
  }
  for (const sheet of document.styleSheets) readSheet(sheet, 0)
  return { fontFaces, fontSheets }
}
