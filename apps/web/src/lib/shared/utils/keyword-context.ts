/**
 * Keyword-in-context excerpting: given a body of text and the search term that
 * matched it, produce a short window of that text centred on the match, split
 * into runs so the matched runs render as highlighted text.
 *
 * Segments are data, not markup — the render site emits them as React text
 * nodes, so highlighting a term never opens an HTML injection surface. Pure
 * and client-safe, so the server can build an excerpt and any surface can
 * split a string it already holds.
 */
import { stripHtml, stripMarkdownPreview } from './string'

/** The body as one line of prose: markdown structure first (its list and
 *  heading rules are line-anchored, so they need the newlines still present),
 *  then any HTML and the whitespace collapse. Uncapped — the window below is
 *  what decides how much of it the excerpt keeps. */
const flatten = (content: string) => stripHtml(stripMarkdownPreview(content, Infinity))

/** One run of text, flagged when it is an occurrence of a search term. */
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

export interface KeywordContextOptions {
  /** Characters of lead-in kept before the match, so the excerpt reads as a
   *  sentence rather than starting on the keyword. */
  lead?: number
  /** Excerpt budget in characters, ellipses excluded. */
  window?: number
}

const ELLIPSIS = '…'

/**
 * The excerpt of `content` around the first occurrence of `term`, already
 * split for highlighting — or null when the term does not literally occur
 * (an unmatched body, an empty term, or a match the SQL wildcard semantics
 * found but the literal text does not contain). Callers treat null as "no
 * keyword context to show" and fall back to their ordinary preview.
 *
 * The body is flattened to one line first, so a markdown or multi-paragraph
 * message excerpts as readable prose. The window snaps to word boundaries at
 * both ends and never trims the match itself out of view.
 */
export function keywordInContext(
  content: string,
  term: string,
  { lead = 40, window = 150 }: KeywordContextOptions = {}
): TermSegment[] | null {
  const needle = term.trim()
  if (!needle || !content) return null

  const flat = flatten(content)
  const at = flat.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return null

  // The budget always covers the match itself, however long the term is.
  const span = Math.max(window, needle.length)

  let start = Math.max(0, at - lead)
  if (start > 0) {
    // Snap forward to the next word start, but only while the match stays in.
    const boundary = flat.indexOf(' ', start)
    if (boundary >= 0 && boundary < at) start = boundary + 1
  }
  let end = Math.min(flat.length, start + span)
  if (end < flat.length) {
    // Snap back to the previous word end, but never inside the match.
    const boundary = flat.lastIndexOf(' ', end)
    if (boundary > at + needle.length) end = boundary
  }

  const body = flat.slice(start, end).trim()
  const excerpt = `${start > 0 ? ELLIPSIS : ''}${body}${end < flat.length ? ELLIPSIS : ''}`
  return splitByTerms(excerpt, needle)
}
