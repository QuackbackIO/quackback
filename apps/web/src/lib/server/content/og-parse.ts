/**
 * OpenGraph / Twitter meta-tag parser.
 *
 * Pure function: no I/O, no imports, never throws.
 * Only scans up to the first 200 KB of HTML, stopping at </head>.
 */

const MAX_SCAN_BYTES = 200 * 1024

/** Decode the five named HTML entities plus decimal and hex character references. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCodePoint(Number(dec)))
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

export interface OpenGraphData {
  title: string | null
  description: string | null
  siteName: string | null
  imageUrl: string | null
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
      htmlTitle = decodeEntities(stripControl(titleMatch[1]))
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
      const decoded = decodeEntities(stripControl(content))

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

    // Resolve and validate image URL
    let imageUrl: string | null = null
    if (rawImage) {
      try {
        const resolved = new URL(rawImage, baseUrl)
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
          imageUrl = resolved.href
        }
      } catch {
        // Malformed URL — leave null
      }
    }

    return {
      title: cap(rawTitle, 200),
      description: cap(rawDescription, 500),
      siteName: cap(rawSiteName, 100),
      imageUrl,
    }
  } catch {
    return { title: null, description: null, siteName: null, imageUrl: null }
  }
}
