/**
 * Secure external URL unfurler.
 *
 * All outbound fetches go through `safeFetch` (SSRF-validated, IP-pinned).
 * A manual redirect-following loop (max 3 hops) re-validates each hop.
 * Images are fetched, magic-byte verified, and uploaded to our storage — never
 * hotlinked. Never throws; degrades to null on any failure.
 */

import { safeFetch, SsrfError, TimeoutError } from './ssrf-guard'
import { sniffImageMime, ALLOWED_REHOST_MIMES } from './magic-bytes'
import { uploadImageBuffer } from '@/lib/server/storage/s3'
import { parseOpenGraph } from './og-parse'

export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  siteName: string | null
  imageUrl: string | null
}

const MAX_REDIRECTS = 3
const PAGE_TIMEOUT_MS = 5_000
const PAGE_MAX_BYTES = 512 * 1024
const IMAGE_TIMEOUT_MS = 10_000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

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
 * Fetch an image URL, magic-byte verify it, and upload to our storage.
 * Returns the proxied URL on success, null on any failure.
 */
async function proxyImage(rawImageUrl: string): Promise<string | null> {
  let response: Response
  try {
    response = await safeFetch(rawImageUrl, {
      method: 'GET',
      timeoutMs: IMAGE_TIMEOUT_MS,
      maxResponseBytes: IMAGE_MAX_BYTES,
      onOverflow: 'error',
    })
  } catch {
    return null
  }

  if (response.status >= 300 || !response.ok) return null

  const headerMime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
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
    const { url } = await uploadImageBuffer(buffer, sniffed, 'link-previews')
    return url
  } catch {
    return null
  }
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

    // Proxy the OG image
    let proxiedImage: string | null = null
    if (og.imageUrl) {
      proxiedImage = await proxyImage(og.imageUrl)
    }

    const preview: LinkPreview = {
      url: finalUrl,
      title: og.title,
      description: og.description,
      siteName: og.siteName,
      imageUrl: proxiedImage,
    }

    // Nothing worth showing
    if (!preview.title && !preview.description && !preview.imageUrl) return null

    return preview
  } catch {
    return null
  }
}
