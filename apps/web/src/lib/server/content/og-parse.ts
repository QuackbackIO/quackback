/**
 * OpenGraph / Twitter meta-tag parser.
 *
 * Pure function: no I/O, no imports, never throws.
 * Only scans up to the first 200 KB of HTML, stopping at </head>.
 */

const MAX_SCAN_BYTES = 200 * 1024

/** Codepoint → char, ignoring out-of-range refs (e.g. &#x110000;) rather than
 *  throwing — a single malformed entity must never discard the whole preview. */
function fromCodePointSafe(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' }

/** Decode the named HTML entities plus decimal and hex character references.
 *  Single pass so produced characters are never re-interpreted as entities
 *  ("&amp;lt;" decodes to "&lt;", not "<"). */
function decodeEntities(s: string): string {
  return s.replace(/&(?:(amp|lt|gt|quot)|#x([0-9a-f]+)|#(\d+));/gi, (_, name, hex, dec) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()]
    return fromCodePointSafe(hex ? parseInt(hex, 16) : Number(dec))
  })
}

/** Strip ASCII control characters (U+0000-U+001F, U+007F). */
function stripControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, '')
}

function cap(s: string | null, max: number): string | null {
  if (s === null) return null
  const trimmed = s.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

/**
 * Extract a tag attribute value from an HTML tag string.
 * Handles both `attr="val"` and `attr='val'` and unquoted values.
 * Attribute order is irrelevant.
 */
function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s/>]*))`, 'i')
  const m = re.exec(tag)
  if (!m) return null
  return m[1] ?? m[2] ?? m[3] ?? null
}

/**
 * Resolve an href against baseUrl and return it only if it's an http(s) URL
 * within maxLen. Returns null on a malformed URL or a disallowed scheme, so the
 * caller can fall through to a default.
 */
function resolveHttpUrl(href: string, baseUrl: string, maxLen = Infinity): string | null {
  try {
    const u = new URL(href, baseUrl)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.href.length <= maxLen) {
      return u.href
    }
  } catch {
    // malformed URL — caller falls back
  }
  return null
}

export interface OpenGraphData {
  title: string | null
  description: string | null
  siteName: string | null
  imageUrl: string | null
  faviconUrl: string | null
}

/**
 * Parse OpenGraph and Twitter Card meta tags from an HTML string.
 *
 * @param html     The raw HTML (possibly truncated by safeFetch's body cap).
 * @param baseUrl  The final URL of the page — used to resolve relative imageUrl.
 */
export function parseOpenGraph(html: string, baseUrl: string): OpenGraphData {
  try {
    // Limit scan and stop at </head> to avoid spending time on the body.
    const scoped = html.slice(0, MAX_SCAN_BYTES)
    const headEnd = scoped.search(/<\/head\s*>/i)
    const head = headEnd !== -1 ? scoped.slice(0, headEnd) : scoped

    let ogTitle: string | null = null
    let ogDescription: string | null = null
    let ogSiteName: string | null = null
    let ogImage: string | null = null
    let twitterTitle: string | null = null
    let twitterDescription: string | null = null
    let twitterImage: string | null = null
    let htmlTitle: string | null = null
    let metaDescription: string | null = null

    // Extract <title>...</title>
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)
    if (titleMatch) {
      htmlTitle = stripControl(decodeEntities(titleMatch[1]))
    }

    // Walk all <meta ...> tags
    const metaRe = /<meta\s[^>]+>/gi
    let m: RegExpExecArray | null
    while ((m = metaRe.exec(head)) !== null) {
      const tag = m[0]
      const property = extractAttr(tag, 'property')?.toLowerCase() ?? ''
      const name = extractAttr(tag, 'name')?.toLowerCase() ?? ''
      const content = extractAttr(tag, 'content')

      if (content === null) continue
      const decoded = stripControl(decodeEntities(content))

      if (property === 'og:title') ogTitle = decoded
      else if (property === 'og:description') ogDescription = decoded
      else if (property === 'og:site_name') ogSiteName = decoded
      else if (property === 'og:image') ogImage = decoded
      else if (name === 'twitter:title') twitterTitle = decoded
      else if (name === 'twitter:description') twitterDescription = decoded
      else if (name === 'twitter:image') twitterImage = decoded
      else if (name === 'description') metaDescription = decoded
    }

    // Priority: og: > twitter: > html fallback
    const rawTitle = ogTitle ?? twitterTitle ?? htmlTitle
    const rawDescription = ogDescription ?? twitterDescription ?? metaDescription
    const rawSiteName = ogSiteName
    const rawImage = ogImage ?? twitterImage

    // Parse favicon links — priority: apple-touch-icon > icon. The rel attribute
    // is a space-separated token set, so `shortcut icon` and `icon shortcut` are
    // the same thing; tokenize rather than string-match the whole value.
    let appleIconHref: string | null = null
    let iconHref: string | null = null
    const linkTagRe = /<link\s[^>]+>/gi
    let lm: RegExpExecArray | null
    while ((lm = linkTagRe.exec(head)) !== null) {
      const tag = lm[0]
      const rel = extractAttr(tag, 'rel')
      const href = extractAttr(tag, 'href')
      if (!rel || !href) continue
      const tokens = rel.trim().toLowerCase().split(/\s+/)
      if (
        (tokens.includes('apple-touch-icon') || tokens.includes('apple-touch-icon-precomposed')) &&
        !appleIconHref
      ) {
        appleIconHref = href
      } else if (tokens.includes('icon') && !iconHref) {
        iconHref = href
      }
    }
    const rawFavicon = appleIconHref ?? iconHref

    // Use the declared favicon if it resolves to a sane http(s) URL; otherwise
    // assume the conventional /favicon.ico at the site root.
    const faviconUrl =
      (rawFavicon ? resolveHttpUrl(rawFavicon, baseUrl, 2048) : null) ??
      resolveHttpUrl('/favicon.ico', baseUrl)

    const imageUrl = rawImage ? resolveHttpUrl(rawImage, baseUrl) : null

    return {
      title: cap(rawTitle, 200),
      description: cap(rawDescription, 500),
      siteName: cap(rawSiteName, 100),
      imageUrl,
      faviconUrl,
    }
  } catch {
    return { title: null, description: null, siteName: null, imageUrl: null, faviconUrl: null }
  }
}
