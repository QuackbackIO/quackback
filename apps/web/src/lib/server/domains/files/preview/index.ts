/**
 * Which deriver reads a stored file, from the family and type sniffed when it
 * was stored. A file with no deriver records previewStatus 'none' without its
 * bytes being read.
 */
import type { FileFamily } from '@/lib/shared/files/file-types'
import { derivePdfPreview } from './pdf'
import { deriveImagePreview } from './image'
import { deriveDocumentPreview } from './document'
import { deriveSpreadsheetPreview } from './spreadsheet'
import { deriveCsvPreview } from './csv'
import { deriveTextPreview } from './text'
import { derivePresentationPreview } from './presentation'
import { deriveArchivePreview } from './archive'
import type { Deadline, PreviewResult } from './result'

export { deriveMediaPreview, type RangeReader } from './media'
export * from './result'

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

/** Run the deriver for a kind that reads the whole file. */
export function deriveFromBytes(
  kind: Exclude<PreviewKind, 'media'>,
  bytes: Uint8Array,
  contentType: string,
  deadline: Pick<Deadline, 'check'>
): Promise<PreviewResult> {
  switch (kind) {
    case 'pdf':
      return derivePdfPreview(bytes, deadline)
    case 'image':
      return deriveImagePreview(bytes, contentType, deadline)
    case 'document':
      return deriveDocumentPreview(bytes)
    case 'spreadsheet':
      return deriveSpreadsheetPreview(bytes, contentType, deadline)
    case 'presentation':
      return derivePresentationPreview(bytes)
    case 'csv':
      return deriveCsvPreview(bytes)
    case 'text':
      return deriveTextPreview(bytes)
    case 'archive':
      return deriveArchivePreview(bytes)
  }
}
