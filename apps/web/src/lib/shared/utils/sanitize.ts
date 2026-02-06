/**
 * HTML/URL sanitization utilities
 *
 * Used by both server-side TipTap JSON sanitizer and client-side rich text renderer.
 */

/**
 * Escape HTML special characters in attribute values to prevent XSS
 */
export function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Sanitize URLs for use in href attributes - only allow safe protocols
 */
export function sanitizeUrl(url: string): string {
  if (!url || typeof url !== 'string') return ''

  try {
    // Handle relative URLs by using a base
    const parsed = new URL(url, 'https://example.com')

    // Only allow safe protocols
    const safeProtocols = ['http:', 'https:', 'mailto:']
    if (!safeProtocols.includes(parsed.protocol)) {
      return ''
    }

    // Return the original URL if it was relative, otherwise the full href
    return url.startsWith('/') ? url : parsed.href
  } catch {
    // Invalid URL - reject it
    return ''
  }
}

/**
 * Sanitize image URLs - allow http(s) and safe raster data URIs.
 * Blocks SVG data URIs which can contain executable script.
 */
export function sanitizeImageUrl(url: string): string {
  if (!url || typeof url !== 'string') return ''

  // Allow data URIs only for safe raster image formats
  if (url.startsWith('data:image/')) {
    // Block SVG data URIs (can contain <script> tags)
    if (url.startsWith('data:image/svg')) {
      return ''
    }
    // Only allow known-safe raster formats
    if (/^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp);/.test(url)) {
      return url
    }
    return ''
  }

  try {
    const parsed = new URL(url, 'https://example.com')

    // Only allow http(s) for image sources
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return ''
    }

    return url.startsWith('/') ? url : parsed.href
  } catch {
    return ''
  }
}

/**
 * Coerce a value to a positive integer within a range, or return a default.
 */
export function safePositiveInt(value: unknown, defaultVal: number, max = 4096): number {
  const num = Number(value)
  if (Number.isFinite(num) && num > 0 && num <= max) {
    return Math.round(num)
  }
  return defaultVal
}

/**
 * Extract YouTube video ID from various URL formats.
 * Returns null if no valid ID found. Only allows safe characters.
 */
export function extractYoutubeId(url: string): string | null {
  if (!url || typeof url !== 'string') return null

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    // Only allow alphanumeric, hyphens, and underscores (actual YouTube ID charset)
    if (match && /^[\w-]+$/.test(match[1])) return match[1]
  }
  return null
}
