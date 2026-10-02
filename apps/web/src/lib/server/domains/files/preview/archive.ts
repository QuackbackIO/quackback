/**
 * Zip archives: how many files the index lists, counted the way the viewer's
 * listing counts them (`isZipFileEntry`). Nothing is inflated, so the
 * office-package budget does not apply; a generous cap keeps a forged index
 * from making the walk itself expensive.
 */
import { isZipFileEntry, readZipIndex } from '@/lib/shared/files/zip-budget'
import type { PreviewResult } from './result'

const MAX_ENTRIES = 1_000_000

export async function deriveArchivePreview(bytes: Uint8Array): Promise<PreviewResult> {
  const index = readZipIndex(bytes, { maxEntries: MAX_ENTRIES })
  return { status: 'ready', meta: { entries: index.filter(isZipFileEntry).length } }
}
