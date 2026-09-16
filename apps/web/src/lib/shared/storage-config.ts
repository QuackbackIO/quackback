/**
 * Shared storage configuration constants.
 * Client-safe subset of lib/server/storage/s3 — no AWS SDK or node:crypto deps.
 */

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/m4v',
])

/** File-picker filter for the video containers the direct-upload path accepts. */
export const VIDEO_FILE_ACCEPT = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
].join(',')

/** Validate that a file is an allowed image type. */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType)
}

/** Video formats that play natively across the supported portal browsers. */
export function isAllowedVideoType(contentType: string): boolean {
  return ALLOWED_VIDEO_TYPES.has(contentType)
}

/**
 * Resolve video MIME types omitted by some desktop file pickers. The server
 * still verifies the file's container signature before storing it.
 */
export function resolveVideoMimeType(contentType: string, filename = ''): string | null {
  if (isAllowedVideoType(contentType)) return contentType
  if (contentType && contentType !== 'application/octet-stream') return null

  const extension = filename.toLowerCase().match(/\.([^.]+)$/)?.[1]
  switch (extension) {
    case 'mp4':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mov':
      return 'video/quicktime'
    case 'm4v':
      return 'video/x-m4v'
    default:
      return null
  }
}

/** MIME value used by the HTML video element after persisted attrs are sanitized. */
export function normalizeVideoMimeType(contentType: unknown): string {
  if (contentType === 'video/webm') return 'video/webm'
  if (contentType === 'video/quicktime') return 'video/quicktime'
  return 'video/mp4'
}

export function isAllowedMediaType(contentType: string): boolean {
  return isAllowedImageType(contentType) || isAllowedVideoType(contentType)
}

/** Maximum allowed file size in bytes (5MB). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

/** Native feedback recordings may be larger than screenshots. */
export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024

export function maxMediaFileSize(contentType: string): number {
  return isAllowedVideoType(contentType) ? MAX_VIDEO_FILE_SIZE : MAX_FILE_SIZE
}
