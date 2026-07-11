/**
 * Pure text helpers for the Ask AI surfaces: query-term highlighting for
 * autocomplete results, plus the shared markdown-lite parser
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

export interface TermSegment {
  text: string
  match: boolean
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Split text into segments, marking case-insensitive occurrences of the
 * query's terms. Single-character terms are ignored as noise. The query is
 * regex-escaped, so user input cannot inject patterns.
 */
export function splitByTerms(text: string, query: string): TermSegment[] {
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
  if (terms.length === 0 || !text) return [{ text, match: false }]

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const parts = text.split(pattern)
  const segments: TermSegment[] = []
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue
    // String.split with a capturing group interleaves matches at odd indexes.
    segments.push({ text: parts[i], match: i % 2 === 1 })
  }
  return segments.length > 0 ? segments : [{ text, match: false }]
}

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
