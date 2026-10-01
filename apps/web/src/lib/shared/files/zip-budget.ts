/**
 * Read zip packages from strangers without letting them choose the cost.
 *
 * Office files are zips, and a zip's index says how big each entry becomes
 * when inflated. A zip bomb either claims a huge size or lies about it, so
 * every reader here checks the index against a budget before inflating
 * anything, then inflates in small steps and stops the moment an entry
 * outgrows what its index declared or what the caller asked for. Inflating
 * in steps bounds both memory and CPU: a lying entry costs at most the cap
 * plus one step, never its real size.
 *
 * A reader that inflates parts (`openZip`) also holds the archive to one
 * reading: no second end record after the one the index came from (a parser
 * that scans from the very end would read another index), and every local
 * header it inflates agrees with the index about method and sizes.
 */
import { Inflate } from 'fflate'

const MB = 1024 * 1024

export interface ZipBudget {
  /** Entries in the index. */
  maxEntries: number
  /** Sum of every entry's declared uncompressed size. */
  maxTotalBytes: number
  /** Declared uncompressed / compressed size, for entries over 1 MB. */
  maxRatio: number
}

export const ZIP_BUDGET: ZipBudget = {
  maxEntries: 2_000,
  maxTotalBytes: 150 * MB,
  maxRatio: 200,
}

/** Small entries compress absurdly well for honest reasons (blank XML parts). */
const RATIO_EXEMPT_BYTES = MB
/** Compressed bytes fed to the inflater per step: one step yields at most ~1,032x this. */
const INFLATE_STEP = 16 * 1024

/** The archive is over budget or lies about its sizes. */
export class ZipBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipBudgetError'
  }
}

/** The bytes are not a zip this reader can follow. */
export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipFormatError'
  }
}

export interface ZipEntry {
  name: string
  /** 0 = stored, 8 = deflate. */
  compression: number
  compressedSize: number
  originalSize: number
  localHeaderOffset: number
}

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8)
}

function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + b[o + 3]! * 0x1000000
}

function u64(b: Uint8Array, o: number): number {
  return u32(b, o) + u32(b, o + 4) * 0x100000000
}

function within(b: Uint8Array, offset: number, length: number): boolean {
  return Number.isSafeInteger(offset) && offset >= 0 && offset + length <= b.length
}

/** The end-of-central-directory record: in the last 22 bytes plus a comment of up to 64 KB. */
function findEndOfCentralDirectory(b: Uint8Array): number {
  const floor = Math.max(0, b.length - 22 - 0xffff)
  for (let i = b.length - 22; i >= floor; i--) {
    if (u32(b, i) === 0x06054b50) return i
  }
  return -1
}

/** Zip64 sizes live in extra field 0x0001, in this order, only for fields that overflowed. */
function applyZip64Extra(
  b: Uint8Array,
  start: number,
  end: number,
  entry: ZipEntry,
  overflow: { original: boolean; compressed: boolean; offset: boolean }
): void {
  for (let p = start; p + 4 <= end;) {
    const id = u16(b, p)
    const size = u16(b, p + 2)
    if (id === 0x0001) {
      let q = p + 4
      if (overflow.original && q + 8 <= end) entry.originalSize = u64(b, q)
      if (overflow.original) q += 8
      if (overflow.compressed && q + 8 <= end) entry.compressedSize = u64(b, q)
      if (overflow.compressed) q += 8
      if (overflow.offset && q + 8 <= end) entry.localHeaderOffset = u64(b, q)
      return
    }
    p += 4 + size
  }
}

/**
 * The entries a zip's central directory lists, without reading any entry's
 * data. `maxEntries` refuses an index before walking it.
 */
export function readZipIndex(bytes: Uint8Array, options: { maxEntries?: number } = {}): ZipEntry[] {
  return readIndex(bytes, options).entries
}

function readIndex(
  bytes: Uint8Array,
  options: { maxEntries?: number }
): { entries: ZipEntry[]; end: number } {
  const eocd = findEndOfCentralDirectory(bytes)
  if (eocd < 0) throw new ZipFormatError('No zip index')

  let count = u16(bytes, eocd + 10)
  let offset = u32(bytes, eocd + 16)
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20
    if (within(bytes, locator, 20) && u32(bytes, locator) === 0x07064b50) {
      const record = u64(bytes, locator + 8)
      if (within(bytes, record, 56) && u32(bytes, record) === 0x06064b50) {
        count = u64(bytes, record + 32)
        offset = u64(bytes, record + 48)
      }
    }
  }
  if (count > (options.maxEntries ?? Infinity)) {
    throw new ZipBudgetError(`Zip lists ${count} entries`)
  }

  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let p = offset
  for (let i = 0; i < count; i++) {
    if (!within(bytes, p, 46) || u32(bytes, p) !== 0x02014b50) {
      throw new ZipFormatError('Broken zip index')
    }
    const nameLength = u16(bytes, p + 28)
    const extraLength = u16(bytes, p + 30)
    const commentLength = u16(bytes, p + 32)
    const nameStart = p + 46
    if (!within(bytes, nameStart, nameLength + extraLength)) {
      throw new ZipFormatError('Broken zip index')
    }
    const entry: ZipEntry = {
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      compression: u16(bytes, p + 10),
      compressedSize: u32(bytes, p + 20),
      originalSize: u32(bytes, p + 24),
      localHeaderOffset: u32(bytes, p + 42),
    }
    const overflow = {
      original: entry.originalSize === 0xffffffff,
      compressed: entry.compressedSize === 0xffffffff,
      offset: entry.localHeaderOffset === 0xffffffff,
    }
    if (overflow.original || overflow.compressed || overflow.offset) {
      const extraStart = nameStart + nameLength
      applyZip64Extra(bytes, extraStart, extraStart + extraLength, entry, overflow)
    }
    entries.push(entry)
    p = nameStart + nameLength + extraLength + commentLength
  }
  return { entries, end: eocd }
}

/** Whether an end-of-central-directory signature starts anywhere after `end`. */
function hasLaterEndRecord(b: Uint8Array, end: number): boolean {
  for (let i = end + 1; i + 4 <= b.length; i++) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return true
  }
  return false
}

/** Refuse an archive whose index promises more than the budget allows. */
export function checkZipBudget(entries: ZipEntry[], budget: ZipBudget = ZIP_BUDGET): void {
  if (entries.length > budget.maxEntries) {
    throw new ZipBudgetError(`Zip lists ${entries.length} entries`)
  }
  let total = 0
  for (const entry of entries) {
    total += entry.originalSize
    if (total > budget.maxTotalBytes) throw new ZipBudgetError('Zip expands past the budget')
    if (
      entry.originalSize > RATIO_EXEMPT_BYTES &&
      entry.originalSize / Math.max(1, entry.compressedSize) > budget.maxRatio
    ) {
      throw new ZipBudgetError('Zip entry compresses past the ratio budget')
    }
  }
}

export interface InflateOptions {
  /** Most bytes to produce. Defaults to the entry's declared size. */
  maxBytes?: number
  /**
   * Return the first `maxBytes` bytes when the entry is longer, instead of
   * refusing it. An entry that outgrows its declared size is still refused.
   */
  truncate?: boolean
}

/**
 * The sizes a local header records: zip64 sizes from its extra field (where
 * a local header carries both, original first) for a field that overflowed.
 */
function localSizes(
  b: Uint8Array,
  local: number,
  extraStart: number,
  extraEnd: number
): { compressed: number; original: number } {
  const sizes = { compressed: u32(b, local + 18), original: u32(b, local + 22) }
  if (sizes.compressed !== 0xffffffff && sizes.original !== 0xffffffff) return sizes
  for (let p = extraStart; p + 4 <= extraEnd;) {
    const id = u16(b, p)
    const size = u16(b, p + 2)
    if (id === 0x0001 && size >= 16 && p + 20 <= extraEnd) {
      return { original: u64(b, p + 4), compressed: u64(b, p + 12) }
    }
    p += 4 + size
  }
  return sizes
}

function entryData(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const local = entry.localHeaderOffset
  if (!within(bytes, local, 30) || u32(bytes, local) !== 0x04034b50) {
    throw new ZipFormatError('Broken zip entry')
  }
  const extraStart = local + 30 + u16(bytes, local + 26)
  const start = extraStart + u16(bytes, local + 28)
  if (!within(bytes, start, entry.compressedSize)) throw new ZipFormatError('Broken zip entry')

  // The local header must tell the same story as the index. One that defers
  // its sizes to a data descriptor (flag bit 3) records zeros instead.
  if (u16(bytes, local + 8) !== entry.compression) {
    throw new ZipFormatError('Zip entry headers disagree')
  }
  if ((u16(bytes, local + 6) & 0x08) === 0) {
    const sizes = localSizes(bytes, local, extraStart, start)
    if (sizes.compressed !== entry.compressedSize || sizes.original !== entry.originalSize) {
      throw new ZipFormatError('Zip entry headers disagree')
    }
  }
  return bytes.subarray(start, start + entry.compressedSize)
}

/**
 * Inflate an entry's data a step at a time, handing each chunk to `onChunk`,
 * which returns true once it has what it needs: the inflater then stops
 * before the rest of the data. An entry that inflates past its declared size
 * is refused at the step that crosses it, and a stream that ends early or
 * does not decode is a format error.
 */
function inflateInSteps(
  data: Uint8Array,
  entry: ZipEntry,
  onChunk: (chunk: Uint8Array) => boolean
): void {
  let produced = 0
  let done = false
  const inflater = new Inflate((chunk) => {
    produced += chunk.byteLength
    if (!done && produced <= entry.originalSize) done = onChunk(chunk)
  })
  try {
    for (let p = 0; p < data.byteLength && !done; p += INFLATE_STEP) {
      const end = Math.min(p + INFLATE_STEP, data.byteLength)
      inflater.push(data.subarray(p, end), end === data.byteLength)
      if (produced > entry.originalSize) throw new ZipBudgetError('Zip entry outgrows its index')
    }
  } catch (err) {
    if (err instanceof ZipBudgetError) throw err
    throw new ZipFormatError('Broken zip entry data')
  }
}

/**
 * Inflate one entry, never producing more than the smaller of its declared
 * size and `maxBytes`. An entry whose data outgrows its declared size is
 * refused whatever the options: its index lied.
 */
export function inflateZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  options: InflateOptions = {}
): Uint8Array {
  const data = entryData(bytes, entry)
  const cap = options.maxBytes ?? entry.originalSize
  if (!options.truncate && entry.originalSize > cap) {
    throw new ZipBudgetError('Zip entry is over the size cap')
  }
  const limit = Math.min(cap, entry.originalSize)

  if (entry.compression === 0) {
    if (data.byteLength > entry.originalSize)
      throw new ZipBudgetError('Zip entry outgrows its index')
    return data.slice(0, limit)
  }
  if (entry.compression !== 8) throw new ZipFormatError('Unsupported zip compression')

  const out = new Uint8Array(limit)
  let filled = 0
  inflateInSteps(data, entry, (chunk) => {
    const take = Math.min(chunk.byteLength, limit - filled)
    out.set(chunk.subarray(0, take), filled)
    filled += take
    // A truncating reader has enough once the buffer is full.
    return options.truncate === true && filled >= limit
  })
  return out.subarray(0, filled)
}

export interface ZipReader {
  entries: ZipEntry[]
  /** An entry's bytes, or null when the archive has no such entry. */
  read(name: string, options?: InflateOptions): Uint8Array | null
}

/**
 * Index the archive, check it against the budget, and read entries by name.
 * An archive with a second end record after the one the index came from is
 * refused: another reader could take that one and read a different index.
 */
export function openZip(bytes: Uint8Array, budget: ZipBudget = ZIP_BUDGET): ZipReader {
  const { entries, end } = readIndex(bytes, { maxEntries: budget.maxEntries })
  if (hasLaterEndRecord(bytes, end)) throw new ZipFormatError('Zip has a second end record')
  checkZipBudget(entries, budget)
  const byName = new Map(entries.map((e) => [e.name, e]))
  return {
    entries,
    read(name, options) {
      const entry = byName.get(name)
      return entry ? inflateZipEntry(bytes, entry, options) : null
    },
  }
}
