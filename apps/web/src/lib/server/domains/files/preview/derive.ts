/**
 * The derivers that parse a whole file's bytes. Only the preview worker
 * (`preview-worker.ts`) runs these; the job reaches them through `sandbox.ts`.
 */
import { derivePdfPreview } from './pdf'
import { deriveImagePreview } from './image'
import { deriveDocumentPreview } from './document'
import { deriveSpreadsheetPreview } from './spreadsheet'
import { deriveCsvPreview } from './csv'
import { deriveTextPreview } from './text'
import { derivePresentationPreview } from './presentation'
import { deriveArchivePreview } from './archive'
import type { ByteKind } from './kind'
import type { Deadline, PreviewResult } from './result'

/** Run the deriver for a kind that reads the whole file. */
export function deriveFromBytes(
  kind: ByteKind,
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
