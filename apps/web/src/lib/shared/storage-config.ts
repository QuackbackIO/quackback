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

const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm'])

/** Validate that a file is an allowed image type. */
export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType)
}

/** Video formats that play natively across the supported portal browsers. */
export function isAllowedVideoType(contentType: string): boolean {
  return ALLOWED_VIDEO_TYPES.has(contentType)
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
