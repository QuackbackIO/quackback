/**
 * The work an engine agrees to do on one file. Office formats are zip
 * packages, and the libraries that read them inflate each part on their own
 * terms, past whatever size the package declares. So before any library sees
 * a package, the engine reads its central directory (names and declared
 * sizes only, nothing inflated), refuses one that would unpack past the
 * budget, inflates each part in small steps that stop at its declared size,
 * and hands the library a rebuilt package of those parts, stored uncompressed.
 * Every parse also runs against a clock: a file that takes longer than
 * `ENGINE_TIMEOUT_MS` is treated as too large to show.
 */
import { zipSync, type Zippable } from 'fflate'
import {
  checkZipBudget,
  inflateZipEntry,
  readZipIndex,
  ZIP_BUDGET,
  ZipBudgetError,
  type ZipEntry,
} from '@/lib/shared/files/zip-budget'
import type { EngineFailure } from '../types'

export const MAX_ZIP_ENTRIES = 2_000
export const MAX_ZIP_UNCOMPRESSED_BYTES = 150 * 1024 * 1024
/**
 * Deflate cannot expand a stream by more than about 1,032:1, so an entry
 * declaring more than this is lying about its size.
 */
const MAX_DEFLATE_RATIO = 1_100
export const ENGINE_TIMEOUT_MS = 15_000

export type ZipRebuildResult =
  | { ok: true; bytes: Uint8Array; entries: number; uncompressedBytes: number }
  | { ok: false; failure: Extract<EngineFailure, 'too_large' | 'corrupt'> }

const TOO_LARGE = { ok: false, failure: 'too_large' } as const
const CORRUPT = { ok: false, failure: 'corrupt' } as const

/**
 * The package rebuilt from its verified parts: every part its index lists,
 * inflated no further than its declared size and stored uncompressed, so
 * whatever library reads the result inflates nothing. A package over the
 * budget is too large; one whose headers disagree, or whose part outgrows the
 * size its headers declare, or that names a part twice, is corrupt.
 */
export function rebuildZipPackage(
  bytes: Uint8Array,
  limits: { maxEntries?: number; maxUncompressedBytes?: number } = {}
): ZipRebuildResult {
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES
  const maxTotalBytes = limits.maxUncompressedBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES
  // The index reader checks every entry against the bytes actually present
  // and refuses an index that lists more than `maxEntries`, so a zip that
  // claims millions of entries is refused before any walk.
  let entries: ZipEntry[]
  try {
    entries = readZipIndex(bytes, { maxEntries })
    checkZipBudget(entries, { ...ZIP_BUDGET, maxEntries, maxTotalBytes })
  } catch (error) {
    return error instanceof ZipBudgetError ? TOO_LARGE : CORRUPT
  }
  if (entries.length === 0) return CORRUPT
  if (entries.some((e) => e.originalSize > Math.max(e.compressedSize, 1) * MAX_DEFLATE_RATIO)) {
    return TOO_LARGE
  }

  // No prototype, so a part named like an object property is just a name.
  const parts: Zippable = Object.create(null) as Zippable
  let uncompressedBytes = 0
  for (const entry of entries) {
    if (!localHeaderAgrees(bytes, entry)) return CORRUPT
    if (entry.name.endsWith('/')) continue
    if (entry.name in parts) return CORRUPT
    try {
      // Stops at the declared size; a part that outgrows it lied.
      const data = inflateZipEntry(bytes, entry)
      parts[entry.name] = data
      uncompressedBytes += data.byteLength
    } catch {
      return CORRUPT
    }
  }
  return {
    ok: true,
    bytes: zipSync(parts, { level: 0 }),
    entries: entries.length,
    uncompressedBytes,
  }
}

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8)
}

function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + b[o + 3]! * 0x1000000
}

const ENCRYPTED = 0x1
const SIZES_IN_DESCRIPTOR = 0x8
const ZIP64_SIZE = 0xffffffff

/**
 * Whether an entry's local header tells the same story as the index: a
 * library that reads the local header would otherwise inflate a different
 * size than the one the budget checked. Sizes a streaming writer defers to a
 * data descriptor (zero here) and Zip64 sizes (in an extra field) leave the
 * index as the only record.
 */
function localHeaderAgrees(bytes: Uint8Array, entry: ZipEntry): boolean {
  const at = entry.localHeaderOffset
  if (!Number.isSafeInteger(at) || at < 0 || at + 30 > bytes.length) return false
  if (u32(bytes, at) !== 0x04034b50) return false
  const flags = u16(bytes, at + 6)
  if (flags & ENCRYPTED) return false
  if (u16(bytes, at + 8) !== entry.compression) return false
  const compressed = u32(bytes, at + 18)
  const original = u32(bytes, at + 22)
  if (compressed === ZIP64_SIZE || original === ZIP64_SIZE) return true
  if (flags & SIZES_IN_DESCRIPTOR && compressed === 0 && original === 0) return true
  return compressed === entry.compressedSize && original === entry.originalSize
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
