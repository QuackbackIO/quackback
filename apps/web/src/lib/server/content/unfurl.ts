/**
 * Secure external URL unfurler.
 *
 * All outbound fetches go through `safeFetch` (SSRF-validated, IP-pinned).
 * A manual redirect-following loop (max 3 hops) re-validates each hop.
 * Images are fetched, magic-byte verified, and uploaded to our storage — never
 * hotlinked. Never throws; degrades to null on any failure.
 */

import { createHash } from 'node:crypto'
import { safeFetch, SsrfError, TimeoutError } from './ssrf-guard'
import { sniffImageMime, ALLOWED_REHOST_MIMES, canonicalizeImageMime } from './magic-bytes'
import { uploadImageBuffer } from '@/lib/server/storage/s3'
import { cacheGet, cacheSet } from '@/lib/server/redis'
import { parseOpenGraph } from './og-parse'

export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
  imageUrl: string | null
  faviconUrl: string | null
}

const MAX_REDIRECTS = 3
const PAGE_TIMEOUT_MS = 5_000
const PAGE_MAX_BYTES = 512 * 1024
const IMAGE_TIMEOUT_MS = 10_000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const FAVICON_TIMEOUT_MS = 5_000
const FAVICON_MAX_BYTES = 64 * 1024
// One favicon URL is shared across every page of a site, so cache the proxied
// result by favicon URL to skip the fetch + upload on subsequent unfurls. Long
// TTL for hits (favicons rarely change); short TTL for misses so a transient
// failure doesn't suppress the icon for long.
const FAVICON_CACHE_TTL_S = 7 * 24 * 60 * 60
const FAVICON_CACHE_NEG_TTL_S = 60 * 60
/** Negative-cache sentinel — distinguishable from any real proxied URL. */
const FAVICON_NONE = '__none'

/**
 * Fetch a URL with SSRF protection and a redirect-following loop (max 3 hops).
 * Each redirect hop is independently SSRF-validated by safeFetch.
 * Returns the final Response and the final URL, or null on any failure.
 */
async function fetchFollowingRedirects(
  rawUrl: string
): Promise<{ response: Response; finalUrl: string } | null> {
  let currentUrl = rawUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response
    try {
      response = await safeFetch(currentUrl, {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'QuackbackLinkPreview/1.0',
        },
        timeoutMs: PAGE_TIMEOUT_MS,
        maxResponseBytes: PAGE_MAX_BYTES,
        onOverflow: 'truncate',
      })
    } catch (err) {
      if (err instanceof SsrfError || err instanceof TimeoutError || err instanceof Error) {
        return null
      }
      return null
    }

    const status = response.status
    if (status >= 300 && status < 400) {
      if (hop === MAX_REDIRECTS) return null // too many redirects
      const location = response.headers.get('location')
      if (!location) return null
      try {
        const resolved = new URL(location, currentUrl)
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
        currentUrl = resolved.href
      } catch {
        return null
      }
      continue
    }

    return { response, finalUrl: currentUrl }
  }
  return null
}

/**
 * Fetch an image/favicon URL, magic-byte verify it against its declared
 * Content-Type, and upload to our storage. Rejects SVG. Returns the proxied URL
 * on success, null on any failure. Uploads are content-addressed so the same
 * bytes (a favicon shared across a site, a repeated OG image) collapse to one
 * stored object instead of accumulating a copy per unfurl.
 */
async function proxyRehostedImage(
  rawUrl: string,
  opts: { timeoutMs: number; maxBytes: number }
): Promise<string | null> {
  let response: Response
  try {
    response = await safeFetch(rawUrl, {
      method: 'GET',
      timeoutMs: opts.timeoutMs,
      maxResponseBytes: opts.maxBytes,
      onOverflow: 'error',
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  const rawMime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const headerMime = canonicalizeImageMime(rawMime)
  if (headerMime === 'image/svg+xml') return null
  if (!ALLOWED_REHOST_MIMES.has(headerMime)) return null

  let buffer: Buffer
  try {
    buffer = Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }

  const sniffed = sniffImageMime(buffer)
  if (sniffed === null || sniffed !== headerMime) return null

  try {
    const { url } = await uploadImageBuffer(buffer, sniffed, 'link-previews', {
      contentAddressed: true,
    })
    return url
  } catch {
    return null
  }
}

const proxyImage = (rawImageUrl: string) =>
  proxyRehostedImage(rawImageUrl, { timeoutMs: IMAGE_TIMEOUT_MS, maxBytes: IMAGE_MAX_BYTES })

const proxyFavicon = (rawFaviconUrl: string) =>
  proxyRehostedImage(rawFaviconUrl, { timeoutMs: FAVICON_TIMEOUT_MS, maxBytes: FAVICON_MAX_BYTES })

/** Cache key for a proxied favicon, derived from its source URL. */
function faviconCacheKey(rawFaviconUrl: string): string {
  return `linkpreview:favicon:v1:${createHash('sha256').update(rawFaviconUrl).digest('hex')}`
}

/**
 * Proxy a favicon, memoized by its source URL in Redis so every page of a site
 * reuses the first page's proxied favicon instead of re-fetching + re-uploading.
 * Caching is best-effort: a Redis miss/error just falls through to proxyFavicon.
 */
async function proxyFaviconCached(rawFaviconUrl: string): Promise<string | null> {
  const key = faviconCacheKey(rawFaviconUrl)
  const cached = await cacheGet<string>(key)
  if (cached !== null) return cached === FAVICON_NONE ? null : cached

  const proxied = await proxyFavicon(rawFaviconUrl)
  await cacheSet(
    key,
    proxied ?? FAVICON_NONE,
    proxied ? FAVICON_CACHE_TTL_S : FAVICON_CACHE_NEG_TTL_S
  )
  return proxied
}

/**
 * Unfurl an external URL: fetch HTML, parse OG tags, proxy the image.
 * Returns null if the URL is unsafe, non-HTML, or yields nothing worth showing.
 * Never throws.
 */
export async function unfurlExternalUrl(rawUrl: string): Promise<LinkPreview | null> {
  try {
    // Validate scheme
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

    const fetched = await fetchFollowingRedirects(rawUrl)
    if (!fetched) return null
    const { response, finalUrl } = fetched

    if (!response.ok) return null
    const ct = response.headers.get('content-type') ?? ''
    if (!ct.startsWith('text/html')) return null

    let html: string
    try {
      html = await response.text()
    } catch {
      return null
    }

    const og = parseOpenGraph(html, finalUrl)

    // Short-circuit before any proxy work if there is nothing worth showing.
    // og.faviconUrl is always set (fallback to /favicon.ico), so without this
    // guard every dead page would cause an external fetch + orphaned S3 upload.
    if (!og.title && !og.description && !og.imageUrl) return null

    // Proxy OG image and favicon in parallel
    const [proxiedImage, proxiedFavicon] = await Promise.all([
      og.imageUrl ? proxyImage(og.imageUrl) : Promise.resolve(null),
      og.faviconUrl ? proxyFaviconCached(og.faviconUrl) : Promise.resolve(null),
    ])

    const preview: LinkPreview = {
      url: finalUrl,
      title: og.title,
      description: og.description,
      siteName: og.siteName,
      imageUrl: proxiedImage,
      faviconUrl: proxiedFavicon,
    }

    // Nothing worth showing
    if (!preview.title && !preview.description && !preview.imageUrl) return null

    return preview
  } catch {
    return null
  }
}
