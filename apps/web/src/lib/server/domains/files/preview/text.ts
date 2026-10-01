/**
 * Text and code: the line count, the first lines for the card, and the
 * leading text as the excerpt. Only the head of the file is decoded; lines
 * are counted on the raw bytes.
 */
import { EXCERPT_MAX_CHARS, cleanText, clip, normalizeExcerpt, type PreviewResult } from './result'

const CARD_LINES = 12
const CARD_LINE_CHARS = 160
/** Enough bytes for the excerpt's characters at four bytes each. */
const HEAD_BYTES = EXCERPT_MAX_CHARS * 4

/** Lines in the bytes: line feeds, plus a last line that does not end in one. */
export function countLines(bytes: Uint8Array): number {
  let lines = 0
  let from = 0
  for (;;) {
    const i = bytes.indexOf(0x0a, from)
    if (i < 0) break
    lines++
    from = i + 1
  }
  return from < bytes.length ? lines + 1 : lines
}

export async function deriveTextPreview(bytes: Uint8Array): Promise<PreviewResult> {
  const head = new TextDecoder().decode(bytes.subarray(0, HEAD_BYTES))
  const firstLines = head
    .split('\n', CARD_LINES)
    .map((line) => clip(cleanText(line.replace(/\r$/, '')).trimEnd(), CARD_LINE_CHARS))
  const text = firstLines.join('\n').trimEnd()
  const lines = countLines(bytes)
  return {
    status: 'ready',
    meta: { ...(lines > 0 ? { lines } : {}), ...(text ? { text } : {}) },
    excerpt: normalizeExcerpt(head),
  }
}
