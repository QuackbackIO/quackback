/**
 * Splitting a long source into retrievable passages (QUINN-PRODUCT P5).
 *
 * Pure and deterministic: the same text always produces the same passages, so
 * a re-index that finds nothing changed can be recognised by its content hash
 * instead of rebuilt.
 *
 * Three properties the rest of the projection depends on:
 *
 * - **Offsets are exact.** `source.slice(chunk.charStart, chunk.charEnd)` is
 *   `chunk.content`, so a passage can always be placed back in the source a
 *   person reads. The heading path rides its own field rather than being
 *   pasted onto the text, which is what keeps that identity true.
 * - **Headings are context, not content.** A markdown heading a passage sits
 *   under is carried as "Billing > Refunds > Annual plans". It is weighted into
 *   the lexical vector and prefixed onto the embedding input, because "how long
 *   does it take" only means something under its heading.
 * - **Boundaries prefer paragraphs.** A passage ends at a blank line whenever
 *   one is near the target, so a passage is a thought rather than a window.
 *   A paragraph longer than the ceiling on its own is split at sentence ends,
 *   then at word boundaries, then bluntly.
 *
 * The sizes are a starting point for evaluation, not a claim about optimal
 * values: roughly 400 to 800 tokens per passage with a modest overlap, using
 * four characters per token as the estimate every adapter in this codebase
 * already assumes.
 */

/** Bumped whenever the output for unchanged input would change. Recorded per generation. */
export const CHUNKER_VERSION = 'v1'

/** Characters per token, the estimate used across this codebase. */
const CHARS_PER_TOKEN = 4

/** ~500 tokens: the size a passage aims for. */
export const CHUNK_TARGET_CHARS = 500 * CHARS_PER_TOKEN
/** ~800 tokens: the size a passage may never exceed. */
export const CHUNK_MAX_CHARS = 800 * CHARS_PER_TOKEN
/** ~100 tokens: enough that a sentence split across a boundary survives in one piece. */
export const CHUNK_OVERLAP_CHARS = 100 * CHARS_PER_TOKEN
/** Below this a trailing fragment is folded into the previous passage instead of standing alone. */
export const CHUNK_MIN_CHARS = 200

export interface SourceChunk {
  ordinal: number
  /** "Billing > Refunds", or null outside any heading. */
  headingPath: string | null
  charStart: number
  charEnd: number
  content: string
}

interface Block {
  start: number
  end: number
  headingPath: string | null
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/

/**
 * Split the source into paragraph blocks, each tagged with the heading path in
 * force where it starts. A heading line is not a block of its own: it belongs
 * to the passages under it, which is what stops a lone "## Refunds" passage
 * from competing with the text that answers the question.
 */
function toBlocks(source: string): Block[] {
  const blocks: Block[] = []
  const headings: string[] = []
  let offset = 0
  let blockStart: number | null = null
  let blockEnd = 0

  const flush = () => {
    if (blockStart === null) return
    // A document that starts at "## Refunds" has no level-one heading, and the
    // gap is a placeholder rather than a name: it is dropped from the path so
    // the passage reads "Refunds", not " > Refunds".
    const named = headings.filter((heading) => heading.length > 0)
    blocks.push({
      start: blockStart,
      end: blockEnd,
      headingPath: named.length > 0 ? named.join(' > ') : null,
    })
    blockStart = null
  }

  for (const line of source.split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      const depth = heading[1].length
      headings.length = Math.min(headings.length, depth - 1)
      while (headings.length < depth - 1) headings.push('')
      headings[depth - 1] = heading[2]
      continue
    }
    if (line.trim().length === 0) {
      flush()
      continue
    }
    if (blockStart === null) blockStart = lineStart
    blockEnd = lineStart + line.length
  }
  flush()
  return blocks
}

/** The last sentence end, then the last word break, then the hard ceiling. */
function breakPoint(source: string, from: number, ceiling: number): number {
  const window = source.slice(from, ceiling)
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('? '),
    window.lastIndexOf('! ')
  )
  if (sentence > CHUNK_MIN_CHARS) return from + sentence + 1
  const word = window.lastIndexOf(' ')
  if (word > CHUNK_MIN_CHARS) return from + word
  return ceiling
}

/**
 * Split one source into passages.
 *
 * Blocks are accumulated until the target is reached; a block that would take
 * the passage past the ceiling starts a new one, and a block that exceeds the
 * ceiling on its own is cut at the best boundary inside it. Consecutive
 * passages overlap by `CHUNK_OVERLAP_CHARS` so a fact written across a
 * paragraph break is whole in at least one of them.
 */
export function chunkSource(source: string): SourceChunk[] {
  const blocks = toBlocks(source)
  if (blocks.length === 0) return []

  const spans: Array<{ start: number; end: number; headingPath: string | null }> = []
  let current: { start: number; end: number; headingPath: string | null } | null = null

  const push = (span: { start: number; end: number; headingPath: string | null }) => {
    if (span.end > span.start) spans.push(span)
  }

  for (const block of blocks) {
    // A block bigger than one passage is cut on its own, at sentence or word
    // boundaries, before anything else can be appended to it.
    let cursor = block.start
    while (block.end - cursor > CHUNK_MAX_CHARS) {
      if (current) {
        push(current)
        current = null
      }
      const end = breakPoint(source, cursor, cursor + CHUNK_MAX_CHARS)
      push({ start: cursor, end, headingPath: block.headingPath })
      cursor = Math.max(end - CHUNK_OVERLAP_CHARS, cursor + 1)
    }
    if (cursor >= block.end) continue

    if (!current) {
      current = { start: cursor, end: block.end, headingPath: block.headingPath }
    } else if (
      block.end - current.start > CHUNK_MAX_CHARS ||
      block.headingPath !== current.headingPath
    ) {
      push(current)
      current = { start: cursor, end: block.end, headingPath: block.headingPath }
    } else {
      current.end = block.end
    }

    if (current.end - current.start >= CHUNK_TARGET_CHARS) {
      push(current)
      current = null
    }
  }
  if (current) push(current)

  // A trailing fragment is folded back rather than left as a passage too small
  // to mean anything on its own.
  if (spans.length > 1) {
    const last = spans[spans.length - 1]
    const previous = spans[spans.length - 2]
    if (
      last.end - last.start < CHUNK_MIN_CHARS &&
      last.headingPath === previous.headingPath &&
      last.end - previous.start <= CHUNK_MAX_CHARS
    ) {
      previous.end = last.end
      spans.pop()
    }
  }

  return spans.map((span, ordinal) => ({
    ordinal,
    headingPath: span.headingPath,
    charStart: span.start,
    charEnd: span.end,
    content: source.slice(span.start, span.end),
  }))
}

/**
 * What a passage is embedded from: its heading path, then its text.
 *
 * The heading is included because a passage under "Refunds" answers "how long
 * does it take" and the passage alone does not say what "it" is.
 */
export function chunkEmbeddingInput(chunk: Pick<SourceChunk, 'headingPath' | 'content'>): string {
  return chunk.headingPath ? `${chunk.headingPath}\n\n${chunk.content}` : chunk.content
}
