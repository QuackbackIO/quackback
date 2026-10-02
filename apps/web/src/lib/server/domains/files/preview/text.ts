/**
 * Text and code: the line count, the first lines for the card, and the
 * leading text as the excerpt. Lines are counted the way the viewer shows
 * them: decoded as UTF-16 when a byte order mark says so (UTF-8 otherwise),
 * broken at CRLF, LF or a lone CR, and a final line break ends the last line
 * rather than starting another.
 */
import { EXCERPT_MAX_CHARS, cleanText, clip, normalizeExcerpt, type PreviewResult } from './result'

const CARD_LINES = 12
const CARD_LINE_CHARS = 160
/** Enough bytes for the excerpt's characters at four bytes each. */
const HEAD_BYTES = EXCERPT_MAX_CHARS * 4

/** The encoding the viewer decodes with: UTF-16 when a byte order mark says so. */
function encodingOf(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return 'utf-8'
}

/** Lines in UTF-8 (or ASCII-compatible) bytes, counted without decoding them. */
function countByteLines(bytes: Uint8Array): number {
  let breaks = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0x0a || (b === 0x0d && bytes[i + 1] !== 0x0a)) breaks++
  }
  const last = bytes[bytes.length - 1]
  return bytes.length > 0 && last !== 0x0a && last !== 0x0d ? breaks + 1 : breaks
}

/** Lines in decoded text, by the same rule. */
function countTextLines(text: string): number {
  if (!text) return 0
  const breaks = text.match(/\r\n?|\n/g)?.length ?? 0
  return /[\r\n]$/.test(text) ? breaks : breaks + 1
}

/** Lines a reader sees in the viewer. */
export function countLines(bytes: Uint8Array): number {
  const encoding = encodingOf(bytes)
  if (encoding === 'utf-8') return countByteLines(bytes)
  return countTextLines(new TextDecoder(encoding).decode(bytes))
}

export async function deriveTextPreview(bytes: Uint8Array): Promise<PreviewResult> {
  const head = new TextDecoder(encodingOf(bytes))
    .decode(bytes.subarray(0, HEAD_BYTES))
    .replace(/\r\n?/g, '\n')
  const firstLines = head
    .split('\n', CARD_LINES)
    .map((line) => clip(cleanText(line).trimEnd(), CARD_LINE_CHARS))
  const text = firstLines.join('\n').trimEnd()
  const lines = countLines(bytes)
  return {
    status: 'ready',
    meta: { ...(lines > 0 ? { lines } : {}), ...(text ? { text } : {}) },
    excerpt: normalizeExcerpt(head),
  }
}
