/**
 * The logo candidates a homepage's HTML names: an inline svg or img in the
 * header's link to the front page, and the logo JSON-LD gives the
 * organisation. Pure: no I/O, never throws (callers catch).
 */
import { decodeEntities, extractAttr, resolveHttpUrl } from '@/lib/server/content/og-parse'
import type { LogoCandidate } from './types'

const MAX_SCAN_CHARS = 1_000_000
const MAX_URL_CHARS = 2048
const MAX_HEADER_CHARS = 150_000
const MAX_HEADER_REGIONS = 3
const MAX_JSON_LD_BLOCKS = 10

const scoped = (html: string) => html.slice(0, MAX_SCAN_CHARS)

const text = (value: string) =>
  decodeEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const urlOf = (href: string | null, baseUrl: string) =>
  href ? resolveHttpUrl(decodeEntities(href.trim()), baseUrl, MAX_URL_CHARS) : null

/** The end of the element whose open tag starts at `start`, counting nested same-name tags. */
function elementEnd(html: string, start: number, name: string, limit: number): number {
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi')
  re.lastIndex = start
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null && match.index < start + limit) {
    if (match[1]) {
      depth--
      if (depth === 0) return re.lastIndex
    } else if (!match[0].endsWith('/>')) depth++
  }
  return Math.min(html.length, start + limit)
}

/** The page's header regions, in document order: header, nav, a banner, or a header-ish class. */
function headerRegions(html: string): string[] {
  const body = html.slice(Math.max(0, html.search(/<body\b/i)))
  const starts: Array<{ index: number; name: string }> = []
  const re =
    /<(header|nav)\b[^>]*>|<(?!(?:html|body|main|script|style|link|meta|img|svg|path|g)\b)([a-z][\w-]*)\b(?=[^>]*(?:\brole\s*=\s*["']?banner|\b(?:class|id)\s*=\s*["'][^"']*(?:header|navbar)))[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null && starts.length < MAX_HEADER_REGIONS * 2) {
    const name = (match[1] ?? match[2]).toLowerCase()
    if (starts.some((s) => match!.index < elementEnd(body, s.index, s.name, MAX_HEADER_CHARS))) {
      continue
    }
    starts.push({ index: match.index, name })
  }
  return starts
    .slice(0, MAX_HEADER_REGIONS)
    .map((s) => body.slice(s.index, elementEnd(body, s.index, s.name, MAX_HEADER_CHARS)))
}

/** Whether a link goes to the site's front page: the root, or a locale's root like /en-gb/. */
function linksToRoot(href: string, baseUrl: string): boolean {
  try {
    const target = new URL(decodeEntities(href.trim()), baseUrl)
    const base = new URL(baseUrl)
    const host = (h: string) => h.toLowerCase().replace(/^www\./, '')
    if (host(target.hostname) !== host(base.hostname)) return false
    return /^\/(?:[a-z]{2}(?:[-_][a-z]{2,4})?\/?)?$/i.test(target.pathname)
  } catch {
    return false
  }
}

/** The balanced <svg>...</svg> starting at `start`, or null when it does not close. */
function balancedSvg(html: string, start: number): string | null {
  const re = /<(\/?)svg\b[^>]*>/gi
  re.lastIndex = start
  let depth = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    if (match[1]) {
      depth--
      if (depth === 0) return html.slice(start, re.lastIndex)
    } else if (!match[0].endsWith('/>')) depth++
    else if (depth === 0) return html.slice(start, re.lastIndex)
  }
  return null
}

const ICON_WORDS = /\b(?:menu|hamburger|burger|search|chevron|caret|arrow|close|toggle)\b/i

/** A hamburger, search glass or chevron rather than a logo. */
function isIconSvg(svg: string, before: string): boolean {
  if (
    /<button\b/i.test(before) &&
    !/<\/button\s*>/i.test(before.slice(before.search(/<button\b/i)))
  ) {
    return true
  }
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ''
  const label = [extractAttr(tag, 'class'), extractAttr(tag, 'id'), extractAttr(tag, 'aria-label')]
    .filter(Boolean)
    .join(' ')
  if (ICON_WORDS.test(label.replace(/[-_]/g, ' '))) return true
  const viewBox = extractAttr(tag, 'viewBox') ?? extractAttr(tag, 'viewbox')
  const sides = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const tiny = sides?.length === 4 && sides[2] <= 24 && sides[3] <= 24
  const hidden = extractAttr(tag, 'aria-hidden')?.toLowerCase() === 'true'
  return Boolean(tiny && hidden && !/<title\b/i.test(svg))
}

/** The largest candidate in a srcset, or null. */
function largestSrcset(srcset: string, baseUrl: string): string | null {
  let best: { url: string; size: number } | null = null
  for (const entry of srcset.split(/,\s+/)) {
    const [href, descriptor = '1x'] = entry.trim().split(/\s+/)
    const size = Number.parseFloat(descriptor) * (descriptor.endsWith('x') ? 1000 : 1)
    const url = urlOf(href, baseUrl)
    if (url && Number.isFinite(size) && (!best || size > best.size)) best = { url, size }
  }
  return best?.url ?? null
}

function imgUrl(tag: string, baseUrl: string): string | null {
  const srcset = extractAttr(tag, 'srcset') ?? extractAttr(tag, 'data-srcset')
  const fromSet = srcset ? largestSrcset(decodeEntities(srcset), baseUrl) : null
  if (fromSet) return fromSet
  return urlOf(extractAttr(tag, 'src'), baseUrl) ?? urlOf(extractAttr(tag, 'data-src'), baseUrl)
}

/** The logo in the first header region's link to the front page: an inline svg or an img. */
export function headerLogos(html: string, baseUrl: string): LogoCandidate[] {
  for (const region of headerRegions(html)) {
    const anchors = /<a\b[^>]*>/gi
    let match: RegExpExecArray | null
    while ((match = anchors.exec(region)) !== null) {
      const tag = match[0]
      const href = extractAttr(tag, 'href')
      if (!href || !linksToRoot(href, baseUrl)) continue
      const close = region.slice(anchors.lastIndex).search(/<\/a\s*>/i)
      const inner = region.slice(
        anchors.lastIndex,
        close === -1 ? region.length : anchors.lastIndex + close
      )
      const label = extractAttr(tag, 'aria-label') ?? extractAttr(tag, 'title')
      const svgStart = inner.search(/<svg\b/i)
      if (svgStart !== -1) {
        const svg = balancedSvg(inner, svgStart)
        if (svg && !isIconSvg(svg, inner.slice(0, svgStart))) {
          const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(svg)?.[1]
          const alt = label ?? (title ? text(title) : null) ?? (text(inner) || null)
          return [{ from: 'header-svg', svg, alt: alt ? decodeEntities(alt) : null, rank: 1 }]
        }
      }
      const img = /<img\b[^>]*>/i.exec(inner)?.[0]
      const url = img ? imgUrl(img, baseUrl) : null
      if (img && url) {
        const alt = extractAttr(img, 'alt') ?? label
        return [{ from: 'header-img', url, alt: alt ? text(alt) || null : null, rank: 2 }]
      }
    }
  }
  return []
}

const ORGANISATION_TYPE = /^(?:organization|corporation|brand|\w*organization)$/i

/** Logos JSON-LD gives an Organization, Corporation or Brand, @graph included. */
export function jsonLdLogos(html: string, baseUrl: string): LogoCandidate[] {
  const logos: LogoCandidate[] = []
  const blocks =
    scoped(html).match(
      /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>[\s\S]*?<\/script\s*>/gi
    ) ?? []
  const logoUrl = (logo: unknown): string | null => {
    if (typeof logo === 'string') return urlOf(logo, baseUrl)
    if (Array.isArray(logo)) return logo.map(logoUrl).find(Boolean) ?? null
    if (logo && typeof logo === 'object') {
      const { url, contentUrl } = logo as Record<string, unknown>
      return logoUrl(url) ?? logoUrl(contentUrl)
    }
    return null
  }
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    const types = ([] as unknown[]).concat(record['@type'] ?? [])
    if (types.some((t) => typeof t === 'string' && ORGANISATION_TYPE.test(t))) {
      const url = logoUrl(record.logo)
      if (url && !logos.some((logo) => logo.url === url)) {
        const name = typeof record.name === 'string' ? record.name : null
        logos.push({ from: 'json-ld', url, alt: name, rank: 3 })
      }
    }
    if (record['@graph']) visit(record['@graph'], depth + 1)
    for (const key of ['publisher', 'brand', 'organization', 'author']) {
      if (record[key]) visit(record[key], depth + 1)
    }
  }
  for (const block of blocks.slice(0, MAX_JSON_LD_BLOCKS)) {
    const json = block.replace(/^<script\b[^>]*>/i, '').replace(/<\/script\s*>$/i, '')
    try {
      visit(JSON.parse(json), 0)
    } catch {
      // A malformed block says nothing.
    }
  }
  return logos
}
