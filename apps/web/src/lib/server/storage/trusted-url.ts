import { config } from '@/lib/server/config'
import { isStoredAssetPath, storedAssetKeyFromSrc, trustedStorageHosts } from './asset-url'
import { PIPELINE_FILES_PREFIX } from '@/lib/shared/files/file-types'

export { PIPELINE_FILES_PREFIX }

/**
 * Only accept attachment/image URLs that came from our own upload pipeline.
 * Parse the URL and match scheme + host + path STRUCTURALLY — a substring check
 * is bypassable (e.g. `javascript:'/api/storage/'` or `https://evil/api/storage/`)
 * and would become a stored XSS / tracking-pixel vector when rendered into an
 * href/src. Used by both the conversation attachment validator and the TipTap content
 * sanitizer (inline `chatImage` nodes), so a visitor can never point an inline
 * image at a third-party host that would fire against an agent's browser.
 *
 * New persist is host-independent (`/api/storage/<key>`). Legacy absolute
 * srcs on this workspace's system or routing hosts stay accepted; the fleet
 * is not rewritten.
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
    if (!isStoredAssetPath(u.pathname)) return false
    return trustedStorageHosts().has(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** The key a URL under the public bucket URL (`S3_PUBLIC_URL`) names, or null. */
function publicBucketKey(url: string): string | null {
  try {
    // Read inside the try: outside a booted process (a build, a unit test)
    // there is no configuration, and so no public bucket URL to match.
    if (!config.s3PublicUrl) return null
    const base = new URL(config.s3PublicUrl)
    const u = new URL(url, config.baseUrl)
    const basePath = base.pathname.replace(/\/$/, '')
    if (u.hostname !== base.hostname || !u.pathname.startsWith(`${basePath}/`)) return null
    const key = decodeURIComponent(u.pathname.slice(basePath.length + 1))
    return key && !key.includes('..') ? key : null
  } catch {
    return null
  }
}

/**
 * Whether a URL names an object the file pipeline stored, on the storage
 * route of any host or under the public bucket URL. Those files are attached
 * by id, whose row says who may attach them, and are never inline: a bare URL
 * to one would be re-signed on every read, past its link's expiry and
 * without that check.
 */
export function namesPipelineFile(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  const key = storedAssetKeyFromSrc(url) ?? publicBucketKey(url)
  return key !== null && key.split('/', 1)[0] === PIPELINE_FILES_PREFIX
}

/**
 * Whether a URL may be rendered as inline media (an `image`, `chatImage` or
 * `video` node's src): it must come from our own upload pipeline or the
 * configured storage host, AND it must not name a file the file pipeline
 * stored — those are attachments, attached by id, never inline. One gate for
 * every inline media node, so a future node type cannot forget either half.
 */
export function isTrustedInlineMediaUrl(url: string): boolean {
  return isTrustedAttachmentUrl(url) && !namesPipelineFile(url)
}
