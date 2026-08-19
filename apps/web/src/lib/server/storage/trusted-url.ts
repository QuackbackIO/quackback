import { config } from '@/lib/server/config'

/**
 * Only accept attachment/image URLs that came from our own upload pipeline.
 * Parse the URL and match scheme + host + path STRUCTURALLY — a substring check
 * is bypassable (e.g. `javascript:'/api/storage/'` or `https://evil/api/storage/`)
 * and would become a stored XSS / tracking-pixel vector when rendered into an
 * href/src. Used by both the conversation attachment validator and the TipTap content
 * sanitizer (inline `chatImage` nodes), so a visitor can never point an inline
 * image at a third-party host that would fire against an agent's browser.
 */
export function isTrustedAttachmentUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  try {
    // Resolve against the app base so relative paths are handled AND dot-segments
    // are canonicalized (`/api/storage/../x` normalizes to `/x` and is rejected).
    const appBase = new URL(config.baseUrl)
    const u = new URL(url, appBase)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (config.s3PublicUrl) {
      const base = new URL(config.s3PublicUrl)
      // Match on a path-segment boundary: a bare prefix check would admit a
      // sibling bucket on the same host (`/bucket` matching `/bucket-evil/x`).
      const basePath = base.pathname.replace(/\/$/, '')
      const pathOk =
        basePath === '' || u.pathname === basePath || u.pathname.startsWith(`${basePath}/`)
      if (u.hostname === base.hostname && pathOk) return true
    }
    return u.hostname === appBase.hostname && u.pathname.startsWith('/api/storage/')
  } catch {
    return false
  }
}
