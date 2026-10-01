/**
 * The work an engine agrees to do on one file. Office formats are zip
 * packages, so before any library inflates a part the engine reads the zip's
 * central directory (names and declared sizes only, nothing inflated) and
 * refuses a package that would unpack past the budget. Every parse also runs
 * against a clock: a file that takes longer than `ENGINE_TIMEOUT_MS` is
 * treated as too large to show.
 */
import { readZipIndex, ZipBudgetError, type ZipEntry } from '@/lib/shared/files/zip-budget'
import type { EngineFailure } from '../types'

export const MAX_ZIP_ENTRIES = 2_000
export const MAX_ZIP_UNCOMPRESSED_BYTES = 150 * 1024 * 1024
/**
 * Deflate cannot expand a stream by more than about 1,032:1, so an entry
 * declaring more than this is lying about its size.
 */
const MAX_DEFLATE_RATIO = 1_100
export const ENGINE_TIMEOUT_MS = 15_000

export type ZipBudgetResult =
  | { ok: true; entries: number; uncompressedBytes: number }
  | { ok: false; failure: Extract<EngineFailure, 'too_large' | 'corrupt'> }

export function checkZipBudget(
  bytes: Uint8Array,
  limits: { maxEntries?: number; maxUncompressedBytes?: number } = {}
): ZipBudgetResult {
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES
  const maxBytes = limits.maxUncompressedBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES
  // The index reader checks every entry against the bytes actually present
  // and refuses an index that lists more than `maxEntries`, so a zip that
  // claims millions of entries is refused before any walk.
  let entries: ZipEntry[]
  try {
    entries = readZipIndex(bytes, { maxEntries })
  } catch (error) {
    return { ok: false, failure: error instanceof ZipBudgetError ? 'too_large' : 'corrupt' }
  }
  if (entries.length === 0) return { ok: false, failure: 'corrupt' }
  let uncompressedBytes = 0
  for (const entry of entries) {
    uncompressedBytes += entry.originalSize
    if (entry.originalSize > Math.max(entry.compressedSize, 1) * MAX_DEFLATE_RATIO) {
      return { ok: false, failure: 'too_large' }
    }
  }
  if (uncompressedBytes > maxBytes) return { ok: false, failure: 'too_large' }
  return { ok: true, entries: entries.length, uncompressedBytes }
}

/** True when the bytes open with a zip local file header. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export class BudgetTimeoutError extends Error {
  constructor() {
    super('The file took too long to open')
    this.name = 'BudgetTimeoutError'
  }
}

/** Settles with `work`, or rejects with `BudgetTimeoutError` after `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number = ENGINE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BudgetTimeoutError()), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
