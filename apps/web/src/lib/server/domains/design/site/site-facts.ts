/**
 * The facts a homepage's HTML and stylesheets state about the brand: its
 * name, language, description, theme colour, favicon, logo and share-image
 * candidates, fonts and colours.
 *
 * Pure: no I/O, never throws. HTML is scanned with tolerant regular
 * expressions in the manner of og-parse.ts, never run, and the scan is capped.
 */
import {
  decodeEntities,
  extractAttr,
  parseIconLinks,
  parseOpenGraph,
  resolveHttpUrl,
} from '@/lib/server/content/og-parse'
import { cleanFamilyName, colourHex, isNeutralColour, readSiteCss } from './site-css'
import { headerLogos, jsonLdLogos } from './site-logos'
import type { ColourCandidate, FaviconCandidate, SiteFacts } from './types'

const MAX_SCAN_CHARS = 1_000_000
const MAX_INLINE_CSS_CHARS = 500_000
const MAX_URL_CHARS = 2048
const MAX_MANIFEST_ICONS = 12
const MAX_NAME_CHARS = 100

/** Stylesheet hosts that serve hosted font families rather than the site's own CSS. */
const HOSTED_FONT_HOSTS = [
  'fonts.googleapis.com',
  'fonts.bunny.net',
  'use.typekit.net',
  'fast.fonts.net',
  'cloud.typography.com',
]
/** Hosts whose stylesheet links name their families in a `family` query parameter. */
const FAMILY_QUERY_HOSTS = new Set(['fonts.googleapis.com', 'fonts.bunny.net'])

const scoped = (html: string) => html.slice(0, MAX_SCAN_CHARS)

function headOf(html: string): string {
  const end = html.search(/<\/head\s*>/i)
  return end === -1 ? html : html.slice(0, end)
}

const text = (value: string) =>
  decodeEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function linkTags(html: string): string[] {
  return scoped(html).match(/<link\s[^>]*>/gi) ?? []
}

const relTokens = (tag: string) => (extractAttr(tag, 'rel') ?? '').trim().toLowerCase().split(/\s+/)

const urlOf = (href: string | null, baseUrl: string) =>
  href ? resolveHttpUrl(decodeEntities(href.trim()), baseUrl, MAX_URL_CHARS) : null

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The page's stylesheet links in document order, absolute: rel=stylesheet,
 * and preloads of a style, without print-only sheets or hosted font services.
 */
export function stylesheetLinks(html: string, baseUrl: string): string[] {
  try {
    const links: string[] = []
    for (const tag of linkTags(html)) {
      const rel = relTokens(tag)
      const isSheet = rel.includes('stylesheet') && !rel.includes('alternate')
      const isPreload = rel.includes('preload') && extractAttr(tag, 'as')?.toLowerCase() === 'style'
      if (!isSheet && !isPreload) continue
      const media = extractAttr(tag, 'media')?.trim().toLowerCase()
      if (media === 'print') continue
      const url = urlOf(extractAttr(tag, 'href'), baseUrl)
      if (!url || HOSTED_FONT_HOSTS.includes(hostOf(url)) || links.includes(url)) continue
      links.push(url)
    }
    return links
  } catch {
    return []
  }
}

/** Families the page loads from a hosted font service's stylesheet link, cleaned. */
export function hostedFontFamilies(html: string, baseUrl: string): string[] {
  try {
    const families = new Map<string, string>()
    for (const tag of linkTags(html)) {
      const url = urlOf(extractAttr(tag, 'href'), baseUrl)
      if (!url) continue
      const parsed = new URL(url)
      if (!FAMILY_QUERY_HOSTS.has(parsed.hostname.toLowerCase())) continue
      for (const param of parsed.searchParams.getAll('family')) {
        for (const entry of param.split('|')) {
          const name = cleanFamilyName(entry.split(':')[0])
          if (name && !families.has(name.toLowerCase())) families.set(name.toLowerCase(), name)
        }
      }
    }
    return [...families.values()]
  } catch {
    return []
  }
}

/** The contents of the page's <style> elements, joined in order and capped. */
export function inlineStyles(html: string): string {
  try {
    const parts: string[] = []
    let size = 0
    const re = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(scoped(html))) !== null && size < MAX_INLINE_CSS_CHARS) {
      if (extractAttr(`<style ${match[1]}>`, 'media')?.trim().toLowerCase() === 'print') continue
      parts.push(match[2])
      size += match[2].length
    }
    return parts.join('\n').slice(0, MAX_INLINE_CSS_CHARS)
  } catch {
    return ''
  }
}

function largestSide(sizes: unknown): number | null {
  if (typeof sizes !== 'string') return null
  const sides = sizes
    .toLowerCase()
    .split(/\s+/)
    .map((entry) => /^(\d{1,5})x(\d{1,5})$/.exec(entry))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Math.min(Number(match[1]), Number(match[2])))
  return sides.length ? Math.max(...sides) : null
}

/** The icons a web app manifest lists, absolute. */
export function manifestIcons(json: string, manifestUrl: string): FaviconCandidate[] {
  try {
    const manifest: unknown = JSON.parse(json)
    if (!manifest || typeof manifest !== 'object') return []
    const icons = (manifest as { icons?: unknown }).icons
    if (!Array.isArray(icons)) return []
    const out: FaviconCandidate[] = []
    for (const icon of icons) {
      if (out.length >= MAX_MANIFEST_ICONS) break
      if (!icon || typeof icon !== 'object') continue
      const { src, sizes, type, purpose } = icon as Record<string, unknown>
      if (typeof src !== 'string') continue
      // A monochrome icon is a silhouette for the system to tint, not the brand's mark.
      if (typeof purpose === 'string' && purpose.trim().toLowerCase() === 'monochrome') continue
      const url = resolveHttpUrl(src.trim(), manifestUrl, MAX_URL_CHARS)
      if (!url) continue
      out.push({
        url,
        size: largestSide(sizes),
        type: typeof type === 'string' ? type.trim().toLowerCase() || null : null,
        from: 'manifest',
      })
    }
    return out
  } catch {
    return []
  }
}

/** Words a page title uses for the page rather than the brand. */
const PAGE_WORDS =
  /^(home|homepage|home page|welcome|official site|official website|index|start|main page)$/i

function letters(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** The brand's name out of a page title such as `Acme Parcel | Parcels, delivered`. */
export function nameFromTitle(title: string, baseUrl: string): string | null {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  let parts = clean.split(/\s+[|\-\u2013\u2014\u00b7\u2022\u00bb:]\s+/)
  if (parts.length === 1) {
    const colon = clean.indexOf(': ')
    if (colon > 0) parts = [clean.slice(0, colon), clean.slice(colon + 2)]
  }
  parts = parts.map((part) => part.trim()).filter((part) => part && !PAGE_WORDS.test(part))
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0].slice(0, MAX_NAME_CHARS)

  const hostLabels = hostOf(baseUrl)
    .replace(/^www\./, '')
    .split('.')
  const site = letters(hostLabels.length > 1 ? hostLabels.slice(0, -1).join('') : hostLabels[0])
  const matching = parts.find((part) => {
    const word = letters(part)
    return word.length >= 2 && site.length >= 2 && (site.includes(word) || word.includes(site))
  })
  if (matching) return matching.slice(0, MAX_NAME_CHARS)

  // No part matches the domain: the shortest part reads most like a name,
  // and the first wins a tie.
  const words = (part: string) => part.split(/\s+/).length
  const best = parts.reduce((a, b) => (words(b) < words(a) ? b : a))
  return best.slice(0, MAX_NAME_CHARS)
}

function themeColourOf(head: string): string | null {
  let dark: string | null = null
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    if (extractAttr(tag, 'name')?.trim().toLowerCase() !== 'theme-color') continue
    const colour = colourHex(decodeEntities(extractAttr(tag, 'content') ?? ''))
    if (!colour) continue
    const media = extractAttr(tag, 'media')?.toLowerCase() ?? ''
    if (/prefers-color-scheme\s*:\s*dark/.test(media)) {
      dark ??= colour
      continue
    }
    return colour
  }
  return dark
}

function htmlLanguage(html: string): string | null {
  const tag = /<html\b[^>]*>/i.exec(scoped(html))?.[0]
  const lang = tag ? extractAttr(tag, 'lang')?.trim().toLowerCase().replace(/_/g, '-') : null
  return lang && /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(lang) ? lang : null
}

function classesOf(tag: string | undefined): string[] {
  if (!tag) return []
  return (extractAttr(tag, 'class') ?? '').split(/\s+/).filter(Boolean)
}

function firstTagClasses(html: string, name: string): string[] {
  return classesOf(new RegExp(`<${name}\\b[^>]*>`, 'i').exec(scoped(html))?.[0])
}

/** What the homepage's HTML and stylesheets say about the brand. */
export function parseSiteFacts(
  html: string,
  baseUrl: string,
  sheets: Array<{ url: string; css: string }>
): SiteFacts {
  const facts: SiteFacts = {
    url: baseUrl,
    name: null,
    nameFrom: null,
    language: null,
    description: null,
    themeColour: null,
    favicons: [],
    manifest: null,
    logos: [],
    shareImage: null,
    fonts: { heading: null, body: null, faces: [], hosted: [] },
    colours: [],
    stylesheets: sheets.map((sheet) => sheet.url),
  }
  try {
    const page = scoped(html)
    const head = headOf(page)
    const og = parseOpenGraph(page, baseUrl)

    facts.language = htmlLanguage(page)
    facts.description = og.description
    facts.themeColour = themeColourOf(head)
    facts.shareImage = og.imageUrl

    facts.favicons = parseIconLinks(page, baseUrl).map((icon) => ({
      url: icon.url,
      size: icon.size,
      type: icon.type,
      from: icon.touch ? 'apple-touch-icon' : 'icon',
    }))
    const manifestTag = linkTags(head).find((tag) => relTokens(tag).includes('manifest'))
    facts.manifest = manifestTag ? urlOf(extractAttr(manifestTag, 'href'), baseUrl) : null

    const logos = [...headerLogos(page, baseUrl), ...jsonLdLogos(page, baseUrl)]
    if (og.imageUrl) logos.push({ from: 'og-image', url: og.imageUrl, alt: null, rank: 9 })
    facts.logos = logos.sort((a, b) => a.rank - b.rank)

    if (og.siteName) {
      facts.name = og.siteName
      facts.nameFrom = 'og:site_name'
    } else {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
      const fromTitle = title ? nameFromTitle(text(title), baseUrl) : null
      const logoAlt = facts.logos.find((logo) => logo.rank <= 2 && logo.alt)?.alt
      if (fromTitle) {
        facts.name = fromTitle
        facts.nameFrom = 'title'
      } else if (logoAlt) {
        facts.name = logoAlt.replace(/\s+(?:logo|home)$/i, '').slice(0, MAX_NAME_CHARS)
        facts.nameFrom = 'logo-alt'
      }
    }

    const bodyClasses = [...firstTagClasses(page, 'html'), ...firstTagClasses(page, 'body')]
    const css = readSiteCss(
      sheets.map((sheet) => sheet.css),
      { headingClasses: firstTagClasses(page, 'h1'), bodyClasses }
    )
    facts.fonts = {
      heading: css.heading,
      body: css.body,
      faces: css.faces,
      hosted: hostedFontFamilies(page, baseUrl),
    }

    const colours: ColourCandidate[] = [...css.colours]
    const theme = facts.themeColour
    if (theme && !isNeutralColour(theme) && !colours.some((c) => c.hex === theme)) {
      colours.push({ hex: theme, from: 'theme-color', weight: 1 })
    }
    facts.colours = colours
  } catch {
    // Whatever was read before the failure stands.
  }
  return facts
}
