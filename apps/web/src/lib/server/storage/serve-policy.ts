/**
 * What a stored file may do when a browser opens it.
 *
 * A stored file's Content-Type comes from whoever uploaded or sent it (an
 * inbound email declares its own), and storage is served from this app's
 * origin when proxied. So only types that cannot run anything are shown
 * inline: raster images, audio, video and PDF. Everything else is a download
 * with a sandbox policy, never a page. Files embedded in the app (an <img>, a
 * <video>) are unaffected: browsers ignore Content-Disposition on embeds.
 */
import { stripInvisible } from '@/lib/shared/files/file-name'

const INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/x-icon',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/m4v',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'application/pdf',
])

/** The redirect path does not see the stored type, so it goes by extension and forces this. */
const INLINE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
}

/** The Content-Security-Policy a download carries, in case it is opened anyway. */
export const DOWNLOAD_CSP = "sandbox; default-src 'none'"

const MAX_DOWNLOAD_NAME_CHARS = 255

export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(contentType.split(';')[0]!.trim().toLowerCase())
}

const STORAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i

/** The name a download is saved under: the file's own name, safe for a header. */
export function downloadFileName(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1).replace(STORAGE_ID, '')
  return base.replace(/[^A-Za-z0-9._-]/g, '_') || 'file'
}

/**
 * A download name a link asks for, safe for a header: no control,
 * bidirectional or invisible characters, quotes, backslashes or path
 * separators, and at most 255 characters with the extension kept. Null when
 * nothing is left.
 */
export function cleanDownloadName(raw: string | null | undefined): string | null {
  const name = stripInvisible(String(raw ?? ''))
    .replace(/["\\/]/g, '')
    .trim()
  if (!name || name === '.' || name === '..') return null
  const chars = Array.from(name)
  if (chars.length <= MAX_DOWNLOAD_NAME_CHARS) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 16 ? Array.from(name.slice(dot)) : []
  return chars.slice(0, MAX_DOWNLOAD_NAME_CHARS - ext.length).join('') + ext.join('')
}

/** RFC 5987 percent-encoding: everything but its attr-chars. */
function extValue(s: string): string {
  return encodeURIComponent(s).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * `attachment`, with the exact name as `filename*` and an ASCII `filename`
 * for clients that read only that. Safe for any name: the ASCII one keeps
 * printable characters other than quotes, backslashes and percent signs.
 */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/gu, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${extValue(name)}`
}

/** Headers that make any response a download under `name`. */
export function downloadHeaders(name: string): Record<string, string> {
  return {
    'Content-Disposition': attachmentDisposition(name),
    'Content-Security-Policy': DOWNLOAD_CSP,
  }
}

/** Headers that make a proxied response a download, unless its type is safe inline. */
export function servedFileHeaders(key: string, contentType: string): Record<string, string> {
  if (isInlineType(contentType)) return {}
  return {
    'Content-Disposition': `attachment; filename="${downloadFileName(key)}"`,
    'Content-Security-Policy': DOWNLOAD_CSP,
  }
}

/** How the redirect path presigns a key: its type forced from the extension, or as a download. */
export function redirectPolicy(key: string): { inlineType: string } | { downloadName: string } {
  const name = key.slice(key.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const inlineType = dot > 0 ? INLINE_EXTENSIONS[name.slice(dot + 1).toLowerCase()] : undefined
  return inlineType ? { inlineType } : { downloadName: downloadFileName(key) }
}
