/**
 * Zip archives: how many files the index lists, counted the way the viewer's
 * listing counts them (folders and nameless entries are not files). Nothing
 * is inflated, so the office-package budget does not apply; a generous cap
 * keeps a forged index from making the walk itself expensive.
 */
import { readZipIndex } from '@/lib/shared/files/zip-budget'
import type { PreviewResult } from './result'

const MAX_ENTRIES = 1_000_000

/** An entry the listing shows as a file: not a folder, and named by something. */
function isFile(name: string): boolean {
  return !name.endsWith('/') && name.split('/').some((part) => part && part !== '.')
}

export async function deriveArchivePreview(bytes: Uint8Array): Promise<PreviewResult> {
  const index = readZipIndex(bytes, { maxEntries: MAX_ENTRIES })
  let entries = 0
  for (const entry of index) if (isFile(entry.name)) entries++
  return { status: 'ready', meta: { entries } }
}
