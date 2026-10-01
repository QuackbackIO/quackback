/**
 * Which deriver reads a stored file, from the family and type sniffed when it
 * was stored. A file with no deriver records previewStatus 'none' without its
 * bytes being read.
 *
 * This module only names the kind. The derivers that parse bytes run in the
 * preview worker (`derive.ts`, reached through `sandbox.ts`), so nothing here
 * imports them.
 */
import type { FileFamily } from '@/lib/shared/files/file-types'

export type PreviewKind =
  | 'pdf'
  | 'image'
  | 'document'
  | 'spreadsheet'
  | 'csv'
  | 'text'
  | 'presentation'
  | 'media'
  | 'archive'

/** The kinds whose deriver parses the whole file, in the preview worker. */
export type ByteKind = Exclude<PreviewKind, 'media'>

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
])
const DOCUMENT_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word.document.macroEnabled.12',
])
const SPREADSHEET_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
])
const PRESENTATION_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
])
/** ISO base media files, whose movie header records a duration. */
const MEDIA_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'audio/mp4'])

export function previewKind(family: FileFamily, contentType: string): PreviewKind | null {
  switch (family) {
    case 'pdf':
      return 'pdf'
    case 'image':
      return IMAGE_TYPES.has(contentType) ? 'image' : null
    case 'document':
      return DOCUMENT_TYPES.has(contentType) ? 'document' : null
    case 'spreadsheet':
      return SPREADSHEET_TYPES.has(contentType) ? 'spreadsheet' : null
    case 'presentation':
      return PRESENTATION_TYPES.has(contentType) ? 'presentation' : null
    case 'csv':
      return 'csv'
    case 'text':
    case 'code':
      return 'text'
    case 'video':
    case 'audio':
      return MEDIA_TYPES.has(contentType) ? 'media' : null
    case 'archive':
      return contentType === 'application/zip' ? 'archive' : null
    default:
      return null
  }
}
