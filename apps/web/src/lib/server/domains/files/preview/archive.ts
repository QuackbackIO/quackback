/**
 * Zip archives: how many entries the index lists. Nothing is inflated, so
 * the office-package budget does not apply; a generous cap keeps a forged
 * index from making the walk itself expensive.
 */
import { readZipIndex } from '@/lib/shared/files/zip-budget'
import type { PreviewResult } from './result'

const MAX_ENTRIES = 1_000_000

export async function deriveArchivePreview(bytes: Uint8Array): Promise<PreviewResult> {
  const entries = readZipIndex(bytes, { maxEntries: MAX_ENTRIES }).length
  return { status: 'ready', meta: { entries } }
}
