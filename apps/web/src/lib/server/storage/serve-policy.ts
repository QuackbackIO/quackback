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

export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(contentType.split(';')[0]!.trim().toLowerCase())
}

const STORAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i

/** The name a download is saved under: the file's own name, safe for a header. */
export function downloadFileName(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1).replace(STORAGE_ID, '')
  return base.replace(/[^A-Za-z0-9._-]/g, '_') || 'file'
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
