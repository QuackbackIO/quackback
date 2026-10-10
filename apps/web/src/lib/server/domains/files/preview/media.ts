/**
 * MP4, MOV and M4A: the duration from the movie header (`moov/mvhd`).
 *
 * The movie box sits before or after the media data, which can be most of a
 * 100 MB file, so the walk reads box headers through ranged reads and skips
 * everything else: a file costs a few small reads whatever its size.
 */
import { boxAt, u32be, u64be } from './boxes'
import { NOTHING_TO_DERIVE, type PreviewResult } from './result'

/** Read `length` bytes at `offset` (fewer at the end of the file). */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>

/** Top-level boxes walked before giving up. */
const MAX_TOP_LEVEL_BOXES = 64
/** The movie header is the movie box's first child in practice; this is generous. */
const MOOV_WINDOW = 256 * 1024
/** Longer than any real recording: a duration past this is a broken header. */
const MAX_DURATION_MS = 1000 * 60 * 60 * 24 * 30

/** Duration in milliseconds from an `mvhd` payload, or null when it is unknown. */
export function parseMvhd(b: Uint8Array, start: number, end: number): number | null {
  const version = b[start]
  const need = version === 1 ? 32 : 20
  if (end - start < need) throw new Error('Truncated movie header')
  const timescale = version === 1 ? u32be(b, start + 20) : u32be(b, start + 12)
  const duration = version === 1 ? u64be(b, start + 24) : u32be(b, start + 16)
  // All ones means "unknown"; fragmented files often write zero.
  const unknown = version === 1 ? duration >= 2 ** 64 - 1 : duration === 0xffffffff
  if (!timescale || !duration || unknown) return null
  const ms = Math.round((duration / timescale) * 1000)
  return Number.isFinite(ms) && ms <= MAX_DURATION_MS ? ms : null
}

/** The duration of an ISO-BMFF file, or null when it does not record one. */
export async function isoBmffDurationMs(read: RangeReader, size: number): Promise<number | null> {
  let offset = 0
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && offset + 8 <= size; i++) {
    const header = await read(offset, 16)
    const box = boxAt(header, 0, offset, size)
    if (!box) return null
    if (box.type === 'moov') {
      const moovLength = box.end - box.start
      const moov = await read(box.start, Math.min(moovLength, MOOV_WINDOW))
      // Children are bounded by the whole movie box, read only through the window.
      for (let p = 0; p + 8 <= moov.length;) {
        const child = boxAt(moov, p, p, moovLength)
        if (!child) break
        if (child.type === 'mvhd')
          return parseMvhd(moov, child.start, Math.min(child.end, moov.length))
        p = child.end
      }
      return null
    }
    offset = box.end
  }
  return null
}

export async function deriveMediaPreview(read: RangeReader, size: number): Promise<PreviewResult> {
  const durationMs = await isoBmffDurationMs(read, size)
  return durationMs === null ? NOTHING_TO_DERIVE : { status: 'ready', meta: { durationMs } }
}
