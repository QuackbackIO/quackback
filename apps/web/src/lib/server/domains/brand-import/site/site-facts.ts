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
import { headerLogos, jsonLdLogos, jsonLdName } from './site-logos'
import { pageElements, readPageStyle } from './site-style'
import type { ColourCandidate, FaviconCandidate, SiteFacts } from './types'

import { siteLabel, writtenAs } from './site-name'
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

  const hostLabels = hostOf(baseUrl)
    .replace(/^www\./, '')
    .split('.')
  const site = letters(hostLabels.length > 1 ? hostLabels.slice(0, -1).join('') : hostLabels[0])
  const named = (part: string) => nameInSentence(part, site)?.slice(0, MAX_NAME_CHARS) ?? null
  if (parts.length === 1) return named(parts[0])
  const matching = parts.find((part) => {
    const word = letters(part)
    return word.length >= 2 && site.length >= 2 && (site.includes(word) || word.includes(site))
  })
  if (matching) return named(matching)

  // No part matches the domain: the shortest part reads most like a name,
  // and the first wins a tie.
  const words = (part: string) => part.split(/\s+/).length
  const best = parts.reduce((a, b) => (words(b) < words(a) ? b : a))
  return named(best)
}

/** A title part of more words than this is a sentence, not a name. */
const MAX_NAME_WORDS = 3
/** Words a title opens with when it greets the visitor rather than naming the brand. */
const GREETING = /^(?:welcome|official|home)\b/i

/**
 * The brand's name in a title part. A short part is the name as written. A
 * sentence (`Welcome to GOV.UK`, `Latest news from the Courier`) names the
 * brand in the words that spell out its domain, and those are the name; a
 * sentence with no such words names no brand, and gives nothing.
 */
function nameInSentence(part: string, site: string): string | null {
  const words = part.split(/\s+/)
  if (words.length <= MAX_NAME_WORDS && !GREETING.test(part)) return part
  // A word of the domain: three letters or more of it, or the whole of it and more (`GOV.UK`).
  const ofSite = (word: string) => {
    const w = letters(word)
    return site.length >= 2 && w.length >= 3 && (site.includes(w) || w.includes(site))
  }
  let best: string[] = []
  let run: string[] = []
  for (const word of words) {
    run = ofSite(word) ? [...run, word] : []
    if (run.length > best.length) best = run
  }
  if (best.length === 0) return words.length <= MAX_NAME_WORDS ? part : null
  const name = best.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** The contents of the head's `<meta name>` tags with one of `names`, in the order named. */
function metaContents(head: string, names: string[]): string[] {
  const found = new Map<string, string>()
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const name = extractAttr(tag, 'name')?.trim().toLowerCase()
    const content = extractAttr(tag, 'content')?.trim()
    if (name && content && names.includes(name) && !found.has(name)) found.set(name, content)
  }
  return names.flatMap((name) => found.get(name) ?? [])
}

/** The name a web app manifest gives the app: its `name`, else its `short_name`. */
export function manifestName(json: string): string | null {
  try {
    const manifest = JSON.parse(json) as { name?: unknown; short_name?: unknown }
    const name = [manifest.name, manifest.short_name].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
    return name ? name.replace(/\s+/g, ' ').trim().slice(0, 200) : null
  } catch {
    return null
  }
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
/** A picker names many local versions; a page with a few names its translations. */
const PICKER_VERSIONS = 5
const MAX_VERSIONS = 400

/**
 * The local versions a country or language picker page names with hreflang
 * links: none when the page is one of them (a local page naming its
 * siblings) or when it names only a few.
 */
function localVersionsOf(head: string, baseUrl: string): { lang: string; url: string }[] {
  const versions = linkTags(head)
    .filter((tag) => relTokens(tag).includes('alternate'))
    .flatMap((tag) => {
      const lang = extractAttr(tag, 'hreflang')?.trim().toLowerCase()
      const url = urlOf(extractAttr(tag, 'href'), baseUrl)
      return lang && url ? [{ lang, url }] : []
    })
    .slice(0, MAX_VERSIONS)
  const page = baseUrl.replace(/\/$/, '')
  const isOne = versions.some(
    (version) => version.lang !== 'x-default' && version.url.replace(/\/$/, '') === page
  )
  return versions.length >= PICKER_VERSIONS && !isOne ? versions : []
}

export function parseSiteFacts(
  html: string,
  baseUrl: string,
  sheets: Array<{ url: string; css: string }>
): SiteFacts {
  const facts: SiteFacts = {
    url: baseUrl,
    name: null,
    nameFrom: null,
    organisationName: null,
    language: null,
    description: null,
    themeColour: null,
    favicons: [],
    manifest: null,
    logos: [],
    shareImage: null,
    fonts: { heading: null, body: null, faces: [], hosted: [] },
    colours: [],
    style: null,
    stylesheets: sheets.map((sheet) => sheet.url),
    localVersions: [],
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
    facts.localVersions = localVersionsOf(head, baseUrl)
    const manifestTag = linkTags(head).find((tag) => relTokens(tag).includes('manifest'))
    facts.manifest = manifestTag ? urlOf(extractAttr(manifestTag, 'href'), baseUrl) : null

    const logos = [...headerLogos(page, baseUrl), ...jsonLdLogos(page, baseUrl)]
    if (og.imageUrl) logos.push({ from: 'og-image', url: og.imageUrl, alt: null, rank: 9 })
    facts.logos = logos.sort((a, b) => a.rank - b.rank)

    facts.organisationName = jsonLdName(page)?.slice(0, MAX_NAME_CHARS) ?? null
    const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
    facts.title = rawTitle ? text(rawTitle).replace(/\s+/g, ' ').trim().slice(0, 400) : null
    facts.declaredNames = [
      og.siteName,
      facts.organisationName,
      ...metaContents(head, ['application-name', 'apple-mobile-web-app-title']),
      facts.logos
        .find((logo) => logo.rank <= 2 && logo.alt)
        ?.alt?.replace(/\s+(?:logo|home)$/i, ''),
    ]
      .map((name) => name?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index)
      .map((name) => name.slice(0, 200))
    const label = siteLabel(baseUrl)
    facts.nameWritten = label
      ? writtenAs(
          `${facts.title ?? ''} ${page
            .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')}`,
          label
        )
      : null
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

    facts.style = readPageStyle(
      sheets.map((sheet) => sheet.css),
      pageElements(page),
      { themeColour: facts.themeColour }
    )
  } catch {
    // Whatever was read before the failure stands.
  }
  return facts
}
