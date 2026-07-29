/**
 * Pure text helpers for the Ask AI surfaces: query-term highlighting for
 * autocomplete results (re-exported from the shared text utilities), plus the
 * shared markdown-lite parser
 * (lib/shared/assistant/markdown-lite.ts) bound to this surface's grammar
 * (paragraphs, bullets, bold, `[n]` citation markers). Both return data
 * structures rendered as React text nodes, so there is no HTML injection
 * surface.
 */
import {
  parseMarkdownLite as parseMarkdownLiteWith,
  type MarkdownLiteBlock,
  type MarkdownLiteSpan,
} from '@/lib/shared/assistant/markdown-lite'

export { splitByTerms, type TermSegment } from '@/lib/shared/utils/keyword-context'

export type InlineSpan = MarkdownLiteSpan
export type { MarkdownLiteBlock }

/**
 * Parse answer text into paragraph and list blocks. Only the structures AI
 * answers are instructed to use here (paragraphs, ordered/bullet lists, bold,
 * and `[n]` citation markers) are recognized; anything else — including
 * italic markers, which this surface's renderer doesn't style — stays
 * literal text.
 */
export function parseMarkdownLite(text: string): MarkdownLiteBlock[] {
  return parseMarkdownLiteWith(text, { citations: true })
}
